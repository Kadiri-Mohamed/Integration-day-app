import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSensitiveRateLimit } from "@/lib/security";
import { AuditLog, BoardGame, BoardGameAssignment, Clue, EventSettings, Game, Match, Rotation, RotationSlot, SoloParticipation, StaffUser, Student, Team } from "@/lib/models";
import { countMatchStatuses, escapeRegex, filterReportRows, toCsv } from "@/lib/domain/reporting";

export const dynamic = "force-dynamic";
const reportTypes = ["participants", "team-composition", "team-generation", "distributions", "rotations", "game-performance", "match-results", "clue-distribution", "solo-participation", "board-attendance", "game-master-activity"] as const;
const querySchema = z.object({ type: z.enum(["overview", ...reportTypes]).default("overview"), format: z.enum(["json", "csv"]).default("json"), q: z.string().trim().max(120).optional(), from: z.string().optional(), to: z.string().optional(), year: z.enum(["A1", "A2"]).optional(), className: z.string().trim().max(60).optional(), gender: z.enum(["F", "M", "X", "UNSPECIFIED"]).optional(), mode: z.enum(["TEAM", "SOLO"]).optional(), teamId: z.string().regex(/^[a-f\d]{24}$/i).optional(), gameId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
const asId = (value: unknown) => value == null ? "" : String(value);
const dateRange = (from?: string, to?: string) => {
  const range: Record<string, Date> = {};
  if (from) { const date = new Date(from); if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE_FILTER"); date.setUTCHours(0, 0, 0, 0); range.$gte = date; }
  if (to) { const date = new Date(to); if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE_FILTER"); date.setUTCHours(23, 59, 59, 999); range.$lte = date; }
  return range;
};

async function getOverview() {
  const [totalParticipants, teamParticipants, soloParticipants, teams, activeGames, boardGames, matchRows, cluesAwarded, settings, frozenGames, inProgressMatches, slots, activeRotation, mastersWithoutAssignment, staleMatches] = await Promise.all([
    Student.countDocuments({}), Student.countDocuments({ mode: "TEAM" }), Student.countDocuments({ mode: "SOLO" }), Team.countDocuments({ status: "ACTIVE" }), Game.countDocuments({ active: true, category: "COMPETITIVE" }), BoardGame.countDocuments({ active: true }), Match.find().select("status rotation rotationSlot game teams assignedGameMaster startedAt round").populate("game", "name station frozen").populate("teams", "name slug").populate("assignedGameMaster", "name").lean(), Clue.countDocuments({ voidedAt: null }), EventSettings.findOne({ key: "event" }).select("rotationCount lifecycleStatus").lean(), Game.find({ active: true, frozen: true }).select("name station").lean(), Match.find({ status: "IN_PROGRESS" }).select("teams game rotation rotationSlot assignedGameMaster startedAt round").populate("game", "name station").populate("teams", "name slug").populate("assignedGameMaster", "name").populate("rotationSlot", "sequence").lean(), RotationSlot.find().select("rotation sequence waitingTeams status startAt endAt").populate("waitingTeams", "name slug").lean(), Rotation.findOne({ status: { $in: ["PUBLISHED", "IN_PROGRESS", "ACTIVE"] } }).sort({ eventVersion: -1 }).lean(), Game.aggregate([{ $match: { active: true, category: "COMPETITIVE" } }, { $lookup: { from: "gameassignments", localField: "_id", foreignField: "game", as: "assignments" } }, { $match: { assignments: { $size: 0 } } }, { $project: { name: 1, station: 1 } }]), Match.find({ status: "IN_PROGRESS", startedAt: { $lt: new Date(Date.now() - 30 * 60_000) } }).select("_id round startedAt").lean(),
  ]);
  const matchCounts = countMatchStatuses(matchRows as { status: string }[]);
  const pendingMatchRows = await Match.find({ status: "PENDING" }).select("game teams assignedGameMaster round createdAt").populate("game", "name station").populate("teams", "name slug").populate("assignedGameMaster", "name").sort({ createdAt: 1 }).limit(1000).lean();
  const active = inProgressMatches as { teams?: { name: string; slug: string }[]; game?: { name?: string; station?: string }; assignedGameMaster?: { name?: string } | null; rotation?: unknown; rotationSlot?: { sequence?: number } | null; round?: number }[];
  const activeRotationMatches = activeRotation ? active.filter((match) => asId(match.rotation) === asId(activeRotation._id)) : active;
  const activeRound = activeRotationMatches.map((match) => Number(match.rotationSlot?.sequence ?? match.round ?? 0)).filter(Boolean).sort((a, b) => a - b)[0] ?? null;
  const waitingTeams = activeRound == null ? [] : (slots as { rotation?: unknown; sequence: number; waitingTeams?: { name: string; slug: string }[] }[]).filter((slot) => asId(slot.rotation) === asId(activeRotation?._id) && slot.sequence === activeRound).flatMap((slot) => slot.waitingTeams ?? []).filter((team, index, list) => list.findIndex((other) => other.slug === team.slug) === index);
  const occupiedStations = active.map((match) => ({ station: match.game?.station || "Unspecified", game: match.game?.name ?? "Unknown game", teams: (match.teams ?? []).map((team) => team.name), gameMaster: match.assignedGameMaster?.name ?? null }));
  const rotationSchedule = activeRotation?.schedule as { rounds?: { number: number; matches?: unknown[]; waitingTeams?: unknown[] }[] } | undefined;
  const rounds = rotationSchedule?.rounds ?? [];
  const roundMatchCounts = new Map<number, { total: number; done: number }>();
  for (const row of matchRows as { rotation?: unknown; round?: number; status: string }[]) if (activeRotation && asId(row.rotation) === asId(activeRotation._id)) { const current = roundMatchCounts.get(Number(row.round)) ?? { total: 0, done: 0 }; current.total++; if (row.status === "DONE") current.done++; roundMatchCounts.set(Number(row.round), current); }
  const currentRotation = activeRound ?? rounds.find((round) => (roundMatchCounts.get(round.number)?.done ?? 0) < (roundMatchCounts.get(round.number)?.total ?? round.matches?.length ?? 0))?.number ?? null;
  const rotationsCompleted = [...roundMatchCounts.entries()].filter(([, value]) => value.total > 0 && value.total === value.done).length;
  const gameMasterAudit = await AuditLog.find({ action: { $in: ["MATCH_STARTED", "MATCH_ENDED", "MATCH_CANCELLED"] }, occurredAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) } }).populate("actor", "name role").sort({ occurredAt: -1 }).limit(20).lean();
  const alerts = [
    ...(active.filter((match) => !match.assignedGameMaster).map((match) => ({ severity: "WARNING", message: `An active match at ${match.game?.station || match.game?.name || "an unspecified station"} has no assigned Game Master.`, targetId: "" }))),
    ...((staleMatches as { _id: unknown; round: number; startedAt: Date }[]).map((match) => ({ severity: "WARNING", message: `Match round ${match.round} has been in progress for over 30 minutes.`, targetId: asId(match._id) }))),
    ...((frozenGames as { name: string; station?: string }[]).map((game) => ({ severity: "INFO", message: `${game.name} is frozen${game.station ? ` at ${game.station}` : ""}.`, targetId: "" }))),
    ...((mastersWithoutAssignment as { name: string; station?: string }[]).map((game) => ({ severity: "WARNING", message: `${game.name} has no active Game Master assignment.`, targetId: "" }))),
    ...(!activeRotation && settings?.lifecycleStatus === "LIVE" ? [{ severity: "WARNING", message: "The event is live but no published rotation schedule is active.", targetId: "" }] : []),
  ];
  return { generatedAt: new Date(), metrics: { totalParticipants, teamParticipants, soloParticipants, teams, activeGames, boardGames, totalMatches: matchRows.length, completedMatches: matchCounts.DONE ?? 0, pendingMatches: matchCounts.PENDING ?? 0, inProgressMatches: matchCounts.IN_PROGRESS ?? 0, cancelledMatches: matchCounts.CANCELLED ?? 0, cluesAwarded, rotationProgress: { current: currentRotation, completed: rotationsCompleted, total: rounds.length || settings?.rotationCount || 0 } }, operations: { currentRotation, teamsPlaying: active.flatMap((match) => (match.teams ?? []).map((team) => ({ ...team, game: match.game?.name ?? null, station: match.game?.station ?? null }))), teamsWaiting: waitingTeams, occupiedStations, frozenStations: frozenGames, gameMasterActivity: gameMasterAudit.map((entry: { actor?: { name?: string; role?: string }; action: string; occurredAt: Date }) => ({ actor: entry.actor?.name ?? "Former staff account", role: entry.actor?.role ?? null, action: entry.action, occurredAt: entry.occurredAt })), incompleteMatches: [...active.map((match) => ({ status: "IN_PROGRESS", game: match.game?.name ?? null, round: match.round ?? null })), ...(pendingMatchRows as { game?: { name?: string }; round?: number }[]).map((match) => ({ status: "PENDING", game: match.game?.name ?? null, round: match.round ?? null }))], alerts } };
}

async function buildRows(type: typeof reportTypes[number], filters: z.infer<typeof querySchema>) {
  const q = filters.q ? new RegExp(escapeRegex(filters.q), "i") : null;
  const dates = dateRange(filters.from, filters.to);
  const studentFilter: Record<string, unknown> = { ...(filters.year ? { year: filters.year } : {}), ...(filters.className ? { className: filters.className } : {}), ...(filters.gender ? { gender: filters.gender } : {}), ...(filters.mode ? { mode: filters.mode } : {}), ...(filters.teamId ? { team: new Types.ObjectId(filters.teamId) } : {}), ...(Object.keys(dates).length ? { createdAt: dates } : {}), ...(q ? { fullName: q } : {}) };
  if (type === "participants") {
    const rows = await Student.find(studentFilter).select("fullName year className gender mode team status createdAt").populate("team", "name").sort({ fullName: 1 }).limit(20000).lean();
    return rows.map((item: { fullName: string; year: string; className: string; gender: string; mode: string; team?: { name?: string } | null; status: string; createdAt: Date }) => ({ fullName: item.fullName, year: item.year, className: item.className, gender: item.gender, mode: item.mode, team: item.team?.name ?? "", status: item.status, date: item.createdAt }));
  }
  if (type === "team-generation") {
    const events = await AuditLog.find({ action: "TEAMS_GENERATED", ...(Object.keys(dates).length ? { occurredAt: dates } : {}) }).populate("actor", "name").sort({ occurredAt: -1 }).limit(5000).lean();
    return events.map((entry: { actor?: { name?: string }; targetId: string; next?: { teams?: { id?: string; name?: string; color?: string; size?: number }[]; seed?: string; policyApproval?: string | null }; occurredAt: Date }) => ({ actor: entry.actor?.name ?? "Former staff account", teamCount: entry.next?.teams?.length ?? 0, teams: (entry.next?.teams ?? []).map((team) => team.name).filter(Boolean).join("; "), sizes: (entry.next?.teams ?? []).map((team) => team.size ?? 0).join("; "), seed: entry.next?.seed ?? "", policyApproval: entry.next?.policyApproval ?? "", targetId: entry.targetId, date: entry.occurredAt }));
  }
  if (type === "team-composition") {
    const teams = await Team.find(filters.teamId ? { _id: filters.teamId } : q ? { name: q } : {}).select("name slug color status locked members createdAt").populate("members", "fullName year className gender mode status").sort({ name: 1 }).limit(5000).lean();
    return teams.map((team: { _id: unknown; name: string; slug: string; color: string; status: string; locked: boolean; members?: { fullName: string; year: string; className: string; gender: string; mode: string; status: string }[]; createdAt: Date }) => {
      const members = team.members ?? [], years = { A1: members.filter((member) => member.year === "A1").length, A2: members.filter((member) => member.year === "A2").length };
      const classes = members.reduce((map, member) => { map[member.className] = (map[member.className] ?? 0) + 1; return map; }, {} as Record<string, number>);
      const genders = members.reduce((map, member) => { map[member.gender] = (map[member.gender] ?? 0) + 1; return map; }, {} as Record<string, number>);
      return { teamId: asId(team._id), team: team.name, slug: team.slug, color: team.color, status: team.status, locked: team.locked, size: members.length, A1: years.A1, A2: years.A2, years: [...new Set(members.map((member) => member.year))], classes: Object.keys(classes), classCounts: classes, genders: Object.keys(genders), genderCounts: genders, modes: [...new Set(members.map((member) => member.mode))], members: members.map((member) => member.fullName).join("; "), memberDetails: members.map((member) => `${member.fullName} (${member.year}/${member.className}/${member.gender})`).join("; "), date: team.createdAt };
    });
  }
  if (type === "distributions") {
    const rows = await Student.aggregate([{ $match: studentFilter }, { $facet: { years: [{ $group: { _id: "$year", count: { $sum: 1 } } }], classes: [{ $group: { _id: "$className", count: { $sum: 1 } } }], genders: [{ $group: { _id: "$gender", count: { $sum: 1 } } }], modes: [{ $group: { _id: "$mode", count: { $sum: 1 } } }] } }]);
    return Object.entries(rows[0] ?? {}).flatMap(([dimension, entries]) => (entries as { _id: string; count: number }[]).map((entry) => ({ dimension: dimension.replace(/s$/, ""), value: entry._id, count: entry.count })));
  }
  if (type === "rotations") {
    const filter: Record<string, unknown> = filters.gameId ? { game: filters.gameId } : {};
    const slots = await RotationSlot.find(filter).populate("rotation", "name eventVersion status").populate("game", "name station").populate("teams", "name slug").populate("waitingTeams", "name slug").sort({ sequence: 1, stationKey: 1, ordinal: 1 }).limit(20000).lean();
    return slots.map((slot: { _id: unknown; rotation?: { name?: string; eventVersion?: number; status?: string }; game?: { _id?: unknown; name?: string; station?: string } | null; sequence: number; startAt?: Date; endAt?: Date; status: string; kind: string; teams?: { name: string; slug: string }[]; waitingTeams?: { name: string; slug: string }[] }) => ({ rotation: slot.rotation?.name ?? "", version: slot.rotation?.eventVersion ?? "", scheduleStatus: slot.rotation?.status ?? "", number: slot.sequence, kind: slot.kind, gameId: asId(slot.game?._id), game: slot.game?.name ?? "", station: slot.game?.station ?? "", teams: (slot.teams ?? []).map((team) => team.name).join("; "), waitingTeams: (slot.waitingTeams ?? []).map((team) => team.name).join("; "), status: slot.status, startAt: slot.startAt ?? null, endAt: slot.endAt ?? null, date: slot.startAt ?? null }));
  }
  if (type === "game-performance") {
    const gameFilter: Record<string, unknown> = { ...(filters.gameId ? { _id: filters.gameId } : {}), ...(q ? { name: q } : {}) };
    const games = await Game.find(gameFilter).select("name category station active frozen awardsClues").sort({ name: 1 }).limit(5000).lean();
    const matchAgg = await Match.aggregate([{ $match: { game: { $in: games.map((g: { _id: unknown }) => g._id) }, ...(Object.keys(dates).length ? { createdAt: dates } : {}) } }, { $group: { _id: { game: "$game", status: "$status" }, count: { $sum: 1 } } }]);
    const clueAgg = await Clue.aggregate([{ $match: { game: { $in: games.map((g: { _id: unknown }) => g._id) }, voidedAt: null, ...(Object.keys(dates).length ? { awardedAt: dates } : {}) } }, { $group: { _id: "$game", count: { $sum: 1 } } }]);
    return (games as { _id: unknown; name: string; category: string; station: string; active: boolean; frozen: boolean; awardsClues: boolean }[]).map((game) => ({ gameId: asId(game._id), game: game.name, category: game.category, station: game.station, active: game.active, frozen: game.frozen, matches: matchAgg.filter((entry: { _id: { game: unknown } }) => asId(entry._id.game) === asId(game._id)).reduce((sum: number, entry: { count: number }) => sum + entry.count, 0), completed: matchAgg.filter((entry: { _id: { game: unknown; status: string } }) => asId(entry._id.game) === asId(game._id) && entry._id.status === "DONE").reduce((sum: number, entry: { count: number }) => sum + entry.count, 0), cluesAwarded: clueAgg.find((entry: { _id: unknown }) => asId(entry._id) === asId(game._id))?.count ?? 0, awardsClues: game.awardsClues }));
  }
  if (type === "match-results") {
    const filter: Record<string, unknown> = { ...(filters.gameId ? { game: filters.gameId } : {}), ...(Object.keys(dates).length ? { completedAt: dates } : {}) };
    const matches = await Match.find(filter).populate("game", "name station").populate("teams", "name slug").populate("winner", "name").populate("assignedGameMaster", "name").sort({ completedAt: -1 }).limit(20000).lean();
    return matches.map((item: { _id: unknown; game?: { _id?: unknown; name?: string; station?: string }; teams?: { name: string }[]; winner?: { name: string } | null; assignedGameMaster?: { name: string } | null; status: string; round: number; resultDetails?: string; startedAt?: Date; completedAt?: Date }) => ({ matchId: asId(item._id), gameId: asId(item.game?._id), game: item.game?.name ?? "", station: item.game?.station ?? "", teams: (item.teams ?? []).map((team) => team.name).join(" vs "), winner: item.winner?.name ?? "", gameMaster: item.assignedGameMaster?.name ?? "", status: item.status, round: item.round, result: item.resultDetails ?? "", startedAt: item.startedAt ?? null, completedAt: item.completedAt ?? null, date: item.completedAt ?? item.startedAt ?? null }));
  }
  if (type === "clue-distribution") {
    const clues = await Clue.aggregate([{ $match: { voidedAt: null, ...(filters.teamId ? { team: new Types.ObjectId(filters.teamId) } : {}), ...(filters.gameId ? { game: new Types.ObjectId(filters.gameId) } : {}), ...(Object.keys(dates).length ? { awardedAt: dates } : {}) } }, { $group: { _id: { team: "$team", game: "$game" }, cluesAwarded: { $sum: 1 }, lastAwardedAt: { $max: "$awardedAt" }, revealedCount: { $sum: { $cond: [{ $ne: ["$revealedAt", null] }, 1, 0] } } } }, { $lookup: { from: "teams", localField: "_id.team", foreignField: "_id", as: "team" } }, { $lookup: { from: "games", localField: "_id.game", foreignField: "_id", as: "game" } }, { $unwind: { path: "$team", preserveNullAndEmptyArrays: true } }, { $unwind: { path: "$game", preserveNullAndEmptyArrays: true } }, { $sort: { "team.name": 1, "game.name": 1 } }]);
    return clues.map((clue: { _id: { team: unknown; game: unknown }; team?: { name?: string }; game?: { name?: string }; cluesAwarded: number; revealedCount: number; lastAwardedAt: Date }) => ({ teamId: asId(clue._id.team), team: clue.team?.name ?? "", gameId: asId(clue._id.game), game: clue.game?.name ?? "", cluesAwarded: clue.cluesAwarded, revealedCount: clue.revealedCount, unrevealedCount: clue.cluesAwarded - clue.revealedCount, lastAwardedAt: clue.lastAwardedAt, date: clue.lastAwardedAt }));
  }
  if (type === "solo-participation") {
    const participations = await SoloParticipation.find({ ...(Object.keys(dates).length ? { joinedAt: dates } : {}) }).populate("activity", "name station").populate("student", "fullName year className gender mode").sort({ joinedAt: -1 }).limit(20000).lean();
    return participations.map((item: { activity?: { name?: string; station?: string }; student?: { fullName?: string; year?: string; className?: string; gender?: string; mode?: string }; status: string; joinedAt: Date; leftAt?: Date | null }) => ({ activity: item.activity?.name ?? "", station: item.activity?.station ?? "", participant: item.student?.fullName ?? "", year: item.student?.year ?? "", className: item.student?.className ?? "", gender: item.student?.gender ?? "", mode: item.student?.mode ?? "", status: item.status, joinedAt: item.joinedAt, leftAt: item.leftAt ?? null, date: item.joinedAt }));
  }
  if (type === "board-attendance") {
    const assignments = await BoardGameAssignment.find({ ...(Object.keys(dates).length ? { createdAt: dates } : {}), ...(filters.teamId ? { team: filters.teamId } : {}) }).populate("boardGame", "name station").populate("session", "label startAt endAt status capacity").populate("student", "fullName year className gender mode").populate("team", "name").sort({ createdAt: -1 }).limit(20000).lean();
    return assignments.map((item: { boardGame?: { name?: string; station?: string }; session?: { label?: string; startAt?: Date; endAt?: Date; status?: string; capacity?: number } | null; student?: { fullName?: string; year?: string; className?: string; gender?: string; mode?: string } | null; team?: { name?: string } | null; status: string; createdAt: Date }) => ({ boardGame: item.boardGame?.name ?? "", station: item.boardGame?.station ?? "", session: item.session?.label ?? "", participant: item.student?.fullName ?? "", year: item.student?.year ?? "", className: item.student?.className ?? "", gender: item.student?.gender ?? "", mode: item.student?.mode ?? "", team: item.team?.name ?? "", sessionStatus: item.session?.status ?? "", sessionCapacity: item.session?.capacity ?? "", status: item.status, date: item.createdAt }));
  }
  const gmIds = await StaffUser.find({ role: "GAME_MASTER" }).distinct("_id");
  const auditRows = await AuditLog.find({ actor: { $in: gmIds }, ...(Object.keys(dates).length ? { occurredAt: dates } : {}), ...(filters.gameId ? { targetId: filters.gameId } : {}) }).populate("actor", "name role").sort({ occurredAt: -1 }).limit(20000).lean();
  return auditRows.map((entry: { actor?: { name?: string; role?: string }; action: string; targetType: string; targetId: string; reason?: string; occurredAt: Date }) => ({ actor: entry.actor?.name ?? "Former staff account", role: entry.actor?.role ?? "", action: entry.action, entityType: entry.targetType, targetId: entry.targetId, reason: entry.reason ?? "", date: entry.occurredAt }));
}

export async function GET(request: Request) {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
    const params = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (params.format === "csv") await assertSensitiveRateLimit(actor.id, "report-csv-export", 30);
    await connectDb();
    if (params.type === "overview") return NextResponse.json(await getOverview(), { headers: { "Cache-Control": "private, no-store" } });
    const rawRows = await buildRows(params.type, params) as Record<string, unknown>[];
    const rows = filterReportRows(rawRows, params.type === "distributions" ? { ...params, q: undefined } : params);
    if (params.format === "csv") return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="youpulse-${params.type}.csv"`, "Cache-Control": "private, no-store" } });
    return NextResponse.json({ type: params.type, filters: params, count: rows.length, rows: rows.slice(0, 1000) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : message === "RATE_LIMITED" ? 429 : message.startsWith("Invalid input") || message === "INVALID_DATE_FILTER" ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? "REPORT_UNAVAILABLE" : message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
