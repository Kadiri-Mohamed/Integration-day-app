import { NextResponse } from "next/server";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { AuditLog, EventSettings, Game, Match, Rotation, RotationSlot, Team } from "@/lib/models";
import { eventTimeToUtc, generateSchedule, regenerateRound, swapTeamsInRound, validateSchedule, type SchedulePlan } from "@/lib/domain/scheduling";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z.object({ action: z.literal("save") }).strict(),
  z.object({ action: z.literal("validate"), rotationId: id }).strict(),
  z.object({ action: z.literal("publish"), rotationId: id }).strict(),
  z.object({ action: z.literal("regenerate"), rotationId: id, round: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("swap"), rotationId: id, round: z.number().int().min(1), teamA: id, teamB: id }).strict(),
  z.object({ action: z.literal("freezeImpact"), gameId: id }).strict(),
  z.object({ action: z.literal("confirmFreeze"), gameId: id, confirmed: z.literal(true), reason: z.string().trim().min(8).max(500) }).strict(),
]);

const serializePlan = (plan: SchedulePlan) => JSON.parse(JSON.stringify(plan)) as SchedulePlan;
function assertEligibleGameConfiguration(games: Array<{ station: string; stationCapacity?: number | null; active: boolean; frozen: boolean; supportedModes: string[]; teamsPerMatch: number }>) {
  const stations = new Set<string>();
  for (const game of games.filter((item) => item.active && !item.frozen && item.supportedModes.includes("TEAM"))) {
    if (!game.station?.trim()) throw new Error("SCHEDULE_MISSING_STATION");
    if (!Number.isInteger(game.stationCapacity) || (game.stationCapacity ?? 0) < 1) throw new Error("SCHEDULE_MISSING_STATION_CAPACITY");
    if (!Number.isInteger(game.teamsPerMatch) || game.teamsPerMatch < 2) throw new Error("SCHEDULE_INVALID_MATCH_CAPACITY");
    const key = game.station.trim().toLocaleLowerCase("en-US");
    if (stations.has(key)) throw new Error("SCHEDULE_DUPLICATE_STATION");
    stations.add(key);
  }
}
function assertScheduleWindow(schedule: SchedulePlan, settings: { eventDate: Date | null; eventTimezone: string | null; startTime: string | null; endTime: string | null; rotationCount: number; rotationDurationMinutes: number; breakDurationMinutes: number }) {
  const startAt = eventTimeToUtc(settings.eventDate ?? null, settings.startTime ?? null, settings.eventTimezone ?? null);
  const endAt = eventTimeToUtc(settings.eventDate ?? null, settings.endTime ?? null, settings.eventTimezone ?? null);
  if (!startAt || !endAt) throw new Error("MISSING_EVENT_SCHEDULE");
  const step = (settings.rotationDurationMinutes + settings.breakDurationMinutes) * 60_000;
  for (let index = 0; index < schedule.rounds.length; index += 1) {
    const round = schedule.rounds[index];
    const expectedStart = startAt.getTime() + index * step;
    const expectedEnd = expectedStart + settings.rotationDurationMinutes * 60_000;
    if (new Date(round.startAt).getTime() !== expectedStart || new Date(round.endAt).getTime() !== expectedEnd) throw new Error("SCHEDULE_STALE_TIMING");
  }
  if (schedule.rounds.length !== settings.rotationCount || new Date(schedule.rounds.at(-1)?.endAt ?? 0) > endAt) throw new Error("SCHEDULE_STALE_TIMING");
}
async function buildPlan() {
  await connectDb();
  const [settings, teams, games] = await Promise.all([
    EventSettings.findOne({ key: "event" }).lean(),
    Team.find({ status: "ACTIVE", locked: true }).select("name").sort({ name: 1 }).lean(),
    Game.find({ category: "COMPETITIVE" }).select("name station stationCapacity active frozen supportedModes teamsPerMatch").sort({ name: 1 }).lean(),
  ]);
  const startAt = eventTimeToUtc(settings?.eventDate ?? null, settings?.startTime ?? null, settings?.eventTimezone ?? null);
  const eventEndAt = eventTimeToUtc(settings?.eventDate ?? null, settings?.endTime ?? null, settings?.eventTimezone ?? null);
  const activeRotations = await Rotation.find({ status: { $in: ["PUBLISHED", "IN_PROGRESS", "ACTIVE"] } }).select("_id eventVersion status").lean();
  const reservations = activeRotations.length ? await Match.find({ rotation: { $in: activeRotations.map((rotation) => rotation._id) }, status: { $in: ["PENDING", "IN_PROGRESS"] } }).select("round game teams").lean() : [];
  const policy = settings?.schedulePolicy ?? { approved: false, oddTeamPolicy: "UNCONFIGURED", capacityOverflowPolicy: "UNCONFIGURED" };
  const plan = generateSchedule({
    teams: teams.map((team) => ({ id: String(team._id), name: team.name })),
    games: games.map((game) => ({ id: String(game._id), name: game.name, station: game.station, stationCapacity: game.stationCapacity, active: game.active, frozen: game.frozen, supportedModes: game.supportedModes, teamsPerMatch: game.teamsPerMatch })),
    rotationCount: settings?.rotationCount ?? 0,
    rotationDurationMinutes: settings?.rotationDurationMinutes ?? 0,
    breakDurationMinutes: settings?.breakDurationMinutes ?? 0,
    startAt: startAt ?? new Date(0),
    eventEndAt,
    policy: policy as { approved: boolean; oddTeamPolicy: "UNCONFIGURED" | "BLOCK" | "BYE" | "WAITING"; capacityOverflowPolicy: "UNCONFIGURED" | "BLOCK" | "WAITING" },
    existingReservations: reservations.map((match) => ({ round: match.round, gameId: String(match.game), teamIds: match.teams.map(String) })),
  });
  if (!settings) plan.conflicts.unshift({ code: "MISSING_EVENT_SETTINGS", message: "Configure event rotation count, duration, date, and start time before planning." });
  else if (!startAt || !eventEndAt || !settings.eventTimezone) plan.conflicts.unshift({ code: "MISSING_EVENT_SCHEDULE", message: "Configure the event date, event time zone, start time, and end time before planning." });
  if (activeRotations.length) plan.conflicts.unshift({ code: "ACTIVE_SCHEDULE_EXISTS", message: "A published or in-progress schedule already reserves matches. Complete or explicitly reschedule that version before publishing another." });
  if (!teams.length) plan.conflicts.unshift({ code: "NO_VALIDATED_TEAMS", message: "Lock validated teams before planning rotations." });
  return { settings, teams, games, plan };
}

export async function GET() {
  try {
    await requireStaff(["SUPER_ADMIN", "ADMIN"]);
    const result = await buildPlan();
    const rotations = await Rotation.find().sort({ eventVersion: -1, createdAt: -1 }).limit(20).select("name eventVersion status publishedAt createdAt").lean();
    return NextResponse.json({ plan: serializePlan(result.plan), policy: result.settings?.schedulePolicy ?? null, rotations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 503 });
  }
}

export async function POST(request: Request) {
  let session: mongoose.ClientSession | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
    await assertSensitiveRateLimit(actor.id, "rotation-planning", 20);
    const input = bodySchema.parse(await request.json());
    const { plan, settings, games, teams } = await buildPlan();
    if (input.action === "preview") return NextResponse.json({ plan: serializePlan(plan) });
    await connectDb();
    session = await Rotation.db.startSession();
    let result: unknown;
    await session.withTransaction(async () => {
      if (input.action === "save") {
        await touchScheduleGuard(session!);
        const latest = await Rotation.findOne().sort({ eventVersion: -1 }).select("eventVersion").session(session!);
        const version = (latest?.eventVersion ?? 0) + 1;
        const [rotation] = await Rotation.create([{ name: `${settings?.eventName ?? "Event"} schedule v${version}`, eventVersion: version, status: "DRAFT", schedule: serializePlan(plan), policySnapshot: settings?.schedulePolicy ?? null, createdBy: actor.id }], { session: session! });
        const slotRows = plan.rounds.flatMap((round) => { const ordinalByGame = new Map<string, number>(); return round.matches.map((match) => { const ordinal = (ordinalByGame.get(match.gameId) ?? 0) + 1; ordinalByGame.set(match.gameId, ordinal); return { rotation: rotation._id, sequence: round.number, stationKey: match.gameId, ordinal, game: match.gameId, station: match.station, teams: match.teams.map((team) => team.id), waitingTeams: round.waitingTeams.map((team) => team.id), label: match.gameName, kind: "GAME", startAt: new Date(round.startAt), endAt: new Date(round.endAt) }; }); });
        if (slotRows.length) await RotationSlot.insertMany(slotRows, { session: session! });
        await AuditLog.create([{ actor: actor.id, action: "ROTATION_DRAFT_CREATED", targetType: "Rotation", targetId: String(rotation._id), next: { eventVersion: version, conflictCount: plan.conflicts.length, schedule: serializePlan(plan) } }], { session: session! });
        result = { id: String(rotation._id), eventVersion: version, status: rotation.status, conflicts: plan.conflicts };
      } else if (input.action === "regenerate") {
        const rotation = await Rotation.findById(input.rotationId).session(session!);
        if (!rotation || rotation.status !== "DRAFT" || !rotation.schedule) throw new Error("ROTATION_NOT_DRAFT");
        if (await Match.exists({ rotation: rotation._id }).session(session!)) throw new Error("DRAFT_HAS_MATCHES");
        const previousSchedule = rotation.schedule as SchedulePlan;
        const previousRound = previousSchedule.rounds.find((item) => item.number === input.round);
        if (!previousRound) throw new Error("ROTATION_NOT_FOUND");
        const regenerated = regenerateRound(previousSchedule, input.round, teams.map((team) => ({ id: String(team._id), name: team.name })), games.map((game) => ({ id: String(game._id), name: game.name, station: game.station, stationCapacity: game.stationCapacity, active: game.active, frozen: game.frozen, supportedModes: game.supportedModes, teamsPerMatch: game.teamsPerMatch })), settings?.rotationDurationMinutes ?? 0, settings?.schedulePolicy ?? { approved: false, oddTeamPolicy: "UNCONFIGURED", capacityOverflowPolicy: "UNCONFIGURED" });
        if (regenerated.conflicts.length) throw new Error(regenerated.conflicts[0].code);
        await RotationSlot.deleteMany({ rotation: rotation._id, sequence: input.round }, { session: session! });
        const newRound = regenerated.plan.rounds.find((item) => item.number === input.round)!;
        const ordinalByGame = new Map<string, number>();
        const slotRows = newRound.matches.map((match) => { const ordinal = (ordinalByGame.get(match.gameId) ?? 0) + 1; ordinalByGame.set(match.gameId, ordinal); return { rotation: rotation._id, sequence: input.round, stationKey: match.gameId, ordinal, game: match.gameId, station: match.station, teams: match.teams.map((team) => team.id), waitingTeams: newRound.waitingTeams.map((team) => team.id), label: match.gameName, kind: "GAME", startAt: new Date(newRound.startAt), endAt: new Date(newRound.endAt) }; });
        if (slotRows.length) await RotationSlot.insertMany(slotRows, { session: session! });
        rotation.schedule = serializePlan(regenerated.plan);
        await rotation.save({ session: session! });
        await AuditLog.create([{ actor: actor.id, action: "ROTATION_DRAFT_REGENERATED", targetType: "Rotation", targetId: String(rotation._id), previous: { round: previousRound }, next: { round: newRound } }], { session: session! });
        result = { id: String(rotation._id), status: rotation.status, round: newRound };
      } else if (input.action === "validate") {
        const rotation = await Rotation.findById(input.rotationId).session(session!);
        if (!rotation || rotation.status !== "DRAFT" || !rotation.schedule) throw new Error("ROTATION_NOT_DRAFT");
        const currentSettings = await EventSettings.findOneAndUpdate({ key: "event" }, { $inc: { scheduleVersion: 1 } }, { new: true, session: session! });
        if (!currentSettings) throw new Error("MISSING_EVENT_SCHEDULE");
        if (await Rotation.exists({ _id: { $ne: rotation._id }, status: { $in: ["PUBLISHED", "IN_PROGRESS", "ACTIVE"] } }).session(session!)) throw new Error("ACTIVE_SCHEDULE_EXISTS");
        const saved = rotation.schedule as SchedulePlan;
        if (saved.conflicts?.length) throw new Error("SCHEDULE_HAS_CONFLICTS");
        if (!currentSettings.schedulePolicy?.approved) throw new Error("SCHEDULE_POLICY_NOT_APPROVED");
        assertScheduleWindow(saved, currentSettings);
        const currentTeams = await Team.find({ status: "ACTIVE", locked: true }).select("_id").session(session!);
        const currentTeamIds = new Set(currentTeams.map((team) => String(team._id)));
        for (const round of saved.rounds) {
          const assigned = round.matches.flatMap((match) => match.teams.map((team) => team.id));
          const waiting = round.waitingTeams.map((team) => team.id);
          const all = [...assigned, ...waiting];
          if (new Set(all).size !== all.length || all.length !== currentTeamIds.size || all.some((teamId) => !currentTeamIds.has(teamId))) throw new Error("SCHEDULE_TEAM_COVERAGE_FAILED");
          const waitingAllowed = currentSettings.schedulePolicy.capacityOverflowPolicy === "WAITING" || currentSettings.schedulePolicy.oddTeamPolicy === "WAITING" || currentSettings.schedulePolicy.oddTeamPolicy === "BYE" && currentTeamIds.size % 2 === 1 && waiting.length === 1;
          if (waiting.length && !waitingAllowed) throw new Error("SCHEDULE_UNEXPLAINED_WAITING");
        }
        const currentGameRows = await Game.find({ category: "COMPETITIVE" }).select("name station stationCapacity active frozen supportedModes teamsPerMatch").session(session!);
        assertEligibleGameConfiguration(currentGameRows);
        const currentGames = new Map(currentGameRows.map((game) => [String(game._id), game]));
        for (const round of saved.rounds) for (const match of round.matches) {
          const game = currentGames.get(match.gameId);
          if (!game?.active || game.frozen || !game.station || match.station !== game.station || !game.supportedModes.includes("TEAM") || !Number.isInteger(game.stationCapacity) || (game.stationCapacity ?? 0) < 1) throw new Error("SCHEDULE_STALE_GAME");
          if (match.teams.length !== game.teamsPerMatch || match.teams.some((team) => !currentTeamIds.has(team.id))) throw new Error("SCHEDULE_STALE_TEAMS");
        }
        const conflicts = validateSchedule(saved, new Map(currentGameRows.map((game) => [String(game._id), game.teamsPerMatch])), new Map(currentGameRows.map((game) => [String(game._id), game.stationCapacity ?? 0])));
        if (conflicts.length) throw new Error("SCHEDULE_VALIDATION_FAILED");
        rotation.status = "VALIDATED";
        await rotation.save({ session: session! });
        await AuditLog.create([{ actor: actor.id, action: "ROTATION_VALIDATED", targetType: "Rotation", targetId: String(rotation._id), next: { status: rotation.status, eventVersion: rotation.eventVersion, estimatedCompletion: saved.estimatedCompletion } }], { session: session! });
        result = { id: String(rotation._id), status: rotation.status, eventVersion: rotation.eventVersion };
      } else if (input.action === "publish") {
        const rotation = await Rotation.findById(input.rotationId).session(session!);
        if (!rotation || rotation.status !== "VALIDATED" || !rotation.schedule) throw new Error("ROTATION_NOT_VALIDATED");
        const currentSettings = await EventSettings.findOneAndUpdate({ key: "event" }, { $inc: { scheduleVersion: 1 } }, { new: true, session: session! });
        if (!currentSettings) throw new Error("MISSING_EVENT_SCHEDULE");
        if (await Rotation.exists({ _id: { $ne: rotation._id }, status: { $in: ["PUBLISHED", "IN_PROGRESS", "ACTIVE"] } }).session(session!)) throw new Error("ACTIVE_SCHEDULE_EXISTS");
        const saved = rotation.schedule as SchedulePlan;
        if (saved.conflicts?.length) throw new Error("SCHEDULE_HAS_CONFLICTS");
        if (!currentSettings.schedulePolicy?.approved) throw new Error("SCHEDULE_POLICY_NOT_APPROVED");
        assertScheduleWindow(saved, currentSettings);
        const currentTeams = await Team.find({ status: "ACTIVE", locked: true }).select("_id").session(session!);
        const currentTeamIds = new Set(currentTeams.map((team) => String(team._id)));
        for (const round of saved.rounds) {
          const assigned = round.matches.flatMap((match) => match.teams.map((team) => team.id));
          const waiting = round.waitingTeams.map((team) => team.id);
          const all = [...assigned, ...waiting];
          if (new Set(all).size !== all.length || all.length !== currentTeamIds.size || all.some((teamId) => !currentTeamIds.has(teamId))) throw new Error("SCHEDULE_TEAM_COVERAGE_FAILED");
          const waitingAllowed = currentSettings.schedulePolicy.capacityOverflowPolicy === "WAITING" || currentSettings.schedulePolicy.oddTeamPolicy === "WAITING" || currentSettings.schedulePolicy.oddTeamPolicy === "BYE" && currentTeamIds.size % 2 === 1 && waiting.length === 1;
          if (waiting.length && !waitingAllowed) throw new Error("SCHEDULE_UNEXPLAINED_WAITING");
        }
        const currentGameRows = await Game.find({ category: "COMPETITIVE" }).select("name station stationCapacity active frozen supportedModes teamsPerMatch").session(session!);
        assertEligibleGameConfiguration(currentGameRows);
        const currentGames = new Map(currentGameRows.map((game) => [String(game._id), game]));
        for (const round of saved.rounds) for (const match of round.matches) {
          const game = currentGames.get(match.gameId);
          if (!game?.active || game.frozen || !game.station || match.station !== game.station || !game.supportedModes.includes("TEAM") || !Number.isInteger(game.stationCapacity) || (game.stationCapacity ?? 0) < 1) throw new Error("SCHEDULE_STALE_GAME");
          if (match.teams.length !== game.teamsPerMatch || match.teams.some((team) => !currentTeamIds.has(team.id))) throw new Error("SCHEDULE_STALE_TEAMS");
        }
        const conflicts = validateSchedule(saved, new Map(currentGameRows.map((game) => [String(game._id), game.teamsPerMatch])), new Map(currentGameRows.map((game) => [String(game._id), game.stationCapacity ?? 0])));
        if (conflicts.length) throw new Error("SCHEDULE_VALIDATION_FAILED");
        const slots = await RotationSlot.find({ rotation: rotation._id }).sort({ sequence: 1, stationKey: 1, ordinal: 1 }).session(session!);
        const slotByKey = new Map(slots.map((slot) => [`${slot.sequence}:${String(slot.game)}:${slot.ordinal}`, slot]));
        const matches = [];
        for (const round of saved.rounds) { const ordinalByGame = new Map<string, number>(); for (const planned of round.matches) {
          const ordinal = (ordinalByGame.get(planned.gameId) ?? 0) + 1; ordinalByGame.set(planned.gameId, ordinal);
          const slot = slotByKey.get(`${round.number}:${planned.gameId}:${ordinal}`);
          if (!slot) throw new Error("SCHEDULE_SLOT_MISSING");
          const [match] = await Match.create([{ game: planned.gameId, rotation: rotation._id, rotationSlot: slot._id, teams: planned.teams.map((team) => team.id), round: round.number, status: "PENDING", idempotencyKey: `schedule:${rotation._id}:${slot._id}` }], { session: session! });
          matches.push(match);
        } }
        const previousStatus = rotation.status;
        rotation.status = "PUBLISHED";
        rotation.publishedAt = new Date();
        rotation.publishedBy = new Types.ObjectId(actor.id);
        await rotation.save({ session: session! });
        await AuditLog.create([{ actor: actor.id, action: "ROTATION_PUBLISHED", targetType: "Rotation", targetId: String(rotation._id), previous: { status: previousStatus }, next: { status: rotation.status, eventVersion: rotation.eventVersion, matchCount: matches.length, estimatedCompletion: saved.estimatedCompletion } }], { session: session! });
        result = { id: String(rotation._id), status: rotation.status, matchCount: matches.length, eventVersion: rotation.eventVersion };
      } else if (input.action === "swap") {
        const rotation = await Rotation.findById(input.rotationId).session(session!);
        if (!rotation || rotation.status !== "DRAFT" || !rotation.schedule) throw new Error("ROTATION_NOT_DRAFT");
        const schedule = rotation.schedule as SchedulePlan;
        const swapped = swapTeamsInRound(schedule, input.round, input.teamA, input.teamB, new Map(games.map((game) => [String(game._id), game.teamsPerMatch])), new Map(games.map((game) => [String(game._id), game.stationCapacity ?? 0])));
        if (swapped.conflicts.length) throw new Error(swapped.conflicts[0].code);
        const updatedSchedule = swapped.plan;
        const round = updatedSchedule.rounds.find((item) => item.number === input.round)!;
        const updated = await RotationSlot.find({ rotation: rotation._id, sequence: input.round }).session(session!);
        for (const slot of updated) {
          const match = round.matches.filter((candidate) => candidate.gameId === String(slot.game))[slot.ordinal - 1];
          if (match) { slot.teams = match.teams.map((team) => new Types.ObjectId(team.id)); slot.waitingTeams = round.waitingTeams.map((team) => new Types.ObjectId(team.id)); await slot.save({ session: session! }); }
        }
        rotation.schedule = serializePlan(updatedSchedule);
        await rotation.save({ session: session! });
        await AuditLog.create([{ actor: actor.id, action: "ROTATION_DRAFT_TEAMS_SWAPPED", targetType: "Rotation", targetId: String(rotation._id), next: { round: input.round, teamA: input.teamA, teamB: input.teamB } }], { session: session! });
        result = { id: String(rotation._id), status: rotation.status, round: input.round, schedule: serializePlan(updatedSchedule) };
      } else {
        const game = await Game.findById(input.gameId).session(session!);
        if (!game) throw new Error("GAME_NOT_FOUND");
        const matches = await Match.find({ game: game._id, status: "PENDING" }).populate("teams", "name").populate("rotationSlot", "sequence startAt").session(session!);
        const activeGames = await Game.find({ _id: { $ne: game._id }, category: "COMPETITIVE", active: true, frozen: false, stationCapacity: { $gte: 1 } }).select("name station stationCapacity teamsPerMatch").lean();
        const alternatives = activeGames.filter((item) => item.station && item.teamsPerMatch === game.teamsPerMatch).map((item) => ({ gameId: String(item._id), name: item.name, station: item.station, capacity: item.stationCapacity }));
        if (input.action === "confirmFreeze") {
          if (game.frozen) { result = { gameId: String(game._id), frozen: true, affectedMatchCount: matches.length, alreadyFrozen: true }; return; }
          await touchScheduleGuard(session!);
          game.frozen = true;
          await game.save({ session: session! });
          await AuditLog.create([{ actor: actor.id, action: "GAME_FROZEN_WITH_IMPACT_CONFIRMATION", targetType: "Game", targetId: String(game._id), previous: { frozen: false }, next: { frozen: true, affectedMatchIds: matches.map((match) => String(match._id)), proposedAlternatives: alternatives }, reason: input.reason }], { session: session! });
          result = { gameId: String(game._id), frozen: true, affectedMatchCount: matches.length, preservedMatches: matches.map((match) => String(match._id)), alternatives };
        } else result = { game: { id: String(game._id), name: game.name, frozen: game.frozen }, affectedMatches: matches.map((match) => ({ id: String(match._id), teams: match.teams, rotationSlot: match.rotationSlot })), alternatives };
      }
    });
    return NextResponse.json(result, { status: input.action === "save" ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : ["ROTATION_NOT_DRAFT", "ROTATION_NOT_VALIDATED", "ROTATION_NOT_FOUND", "DRAFT_HAS_MATCHES", "ACTIVE_SCHEDULE_EXISTS", "SCHEDULE_HAS_CONFLICTS", "SCHEDULE_POLICY_NOT_APPROVED", "MISSING_EVENT_SCHEDULE", "SCHEDULE_STALE_TIMING", "SCHEDULE_TEAM_COVERAGE_FAILED", "SCHEDULE_UNEXPLAINED_WAITING", "SCHEDULE_STALE_GAME", "SCHEDULE_STALE_TEAMS", "SCHEDULE_VALIDATION_FAILED", "SCHEDULE_MISSING_STATION", "SCHEDULE_MISSING_STATION_CAPACITY", "SCHEDULE_INVALID_MATCH_CAPACITY", "SCHEDULE_DUPLICATE_STATION", "SCHEDULE_SLOT_MISSING", "INVALID_SWAP", "TEAM_NOT_IN_ROTATION", "TEAM_DOUBLE_BOOKED", "REPEATED_TEAM_GAME"].includes(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  } finally { await session?.endSession(); }
}
