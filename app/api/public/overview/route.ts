import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BoardGame, BoardGameSession, Clue, EventAnnouncement, EventSettings, Game, Match, SoloActivity, Student, Team } from "@/lib/models";
import { publicRevealProjection } from "@/lib/domain/reveal-policy";
import { rankPublicTeams } from "@/lib/domain/leaderboard";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await connectDb();
    const [settings, teams, games, matches, teamCount, gameCount, studentCount, doneCount, boardGames, boardSessions, soloActivities, announcements] = await Promise.all([
      EventSettings.findOne({ key: "event" }).select("eventName eventDate eventTimezone startTime endTime lifecycleStatus publicLeaderboardEnabled publicMembersEnabled revealStatus revealContent revealedAt").lean(),
      Team.find({ status: "ACTIVE" }).select("_id name slug color members").sort({ name: 1 }).lean(),
      Game.find({ active: true, frozen: false, category: "COMPETITIVE" }).select("name station").sort({ station: 1, name: 1 }).lean(),
      Match.find({ status: { $ne: "CANCELLED" } }).select("game teams winner status round startedAt completedAt").populate("game", "name station").populate("teams", "name slug color").populate("winner", "name slug").sort({ round: 1, createdAt: 1 }).lean(),
      Team.countDocuments({ status: "ACTIVE" }), Game.countDocuments({ active: true, category: "COMPETITIVE", frozen: false }), Student.countDocuments({ status: "ACTIVE" }), Match.countDocuments({ status: "DONE" }),
      BoardGame.find({ active: true }).select("_id name description rules station capacity").sort({ name: 1 }).lean(),
      BoardGameSession.find({ status: { $in: ["SCHEDULED", "IN_PROGRESS"] }, endAt: { $gt: new Date() } }).select("boardGame startAt endAt capacity seatsTaken status").sort({ startAt: 1 }).lean(),
      SoloActivity.find({ active: true, available: true }).select("name description rules station capacity seatsTaken").sort({ name: 1 }).lean(),
      EventAnnouncement.find({ active: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: new Date() } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }] }] }).select("title message startsAt endsAt").sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    const counts = await Clue.aggregate([{ $match: { voidedAt: null } }, { $group: { _id: "$team", count: { $sum: 1 } } }]);
    const clueMap = new Map(counts.map((entry: { _id: unknown; count: number }) => [String(entry._id), entry.count]));
    const sessions = boardSessions as { boardGame: unknown; startAt: Date; endAt: Date; capacity: number; seatsTaken: number; status: string }[];
    const publicBoardGames = (boardGames as { _id: unknown; name: string; description: string; rules: string; station: string; capacity: number }[]).map((game) => {
      const session = sessions.find((item) => String(item.boardGame) === String(game._id));
      return { name: game.name, description: game.description, rules: game.rules, station: game.station, capacity: session?.capacity ?? game.capacity, availableSeats: session ? Math.max(0, session.capacity - session.seatsTaken) : null, sessionStatus: session?.status ?? null, sessionStartsAt: session?.startAt ?? null };
    });
    const teamIds = teams.map((team: { members?: unknown[] }) => team.members ?? []).flat();
    const memberNames = settings?.publicMembersEnabled && teamIds.length ? await Student.find({ _id: { $in: teamIds }, status: "ACTIVE" }).select("_id fullName").lean() : [];
    const memberMap = new Map(memberNames.map((student: { _id: unknown; fullName: string }) => [String(student._id), student.fullName]));
    const projectedMatches = matches.map((match: { game?: { name?: string; station?: string }; teams?: { name: string; slug: string; color: string }[]; winner?: { name?: string; slug?: string } | null; status: string; round: number; completedAt?: Date | null }) => ({ game: match.game?.name ?? "Game", station: match.game?.station ?? null, teams: (match.teams ?? []).map((team) => ({ name: team.name, slug: team.slug, color: team.color })), winner: match.winner ? { name: match.winner.name, slug: match.winner.slug } : null, status: match.status, round: match.round, completedAt: match.completedAt ?? null }));
    const rawTeams = teams as { _id: unknown; name: string; slug: string; color: string; members?: unknown[] }[];
    const publicTeams = rawTeams.map((team) => {
      const related = projectedMatches.filter((match) => match.teams.some((entry) => entry.slug === team.slug));
      const current = related.find((match) => match.status === "IN_PROGRESS") ?? related.find((match) => match.status === "PENDING");
      return { name: team.name, slug: team.slug, color: team.color, clues: clueMap.get(String(team._id)) ?? 0, progress: related.filter((match) => match.status === "DONE").length, total: related.length, currentActivity: current?.game ?? null, matchStatus: current?.status ?? null, members: settings?.publicMembersEnabled ? (team.members ?? []).map((id) => memberMap.get(String(id))).filter(Boolean) : undefined };
    });
    const rankedTeams = rankPublicTeams(publicTeams);
    const finalReveal = publicRevealProjection(settings as { revealStatus?: string; revealContent?: string; revealedAt?: Date | null } | null);
    const competitionMatches = settings?.publicLeaderboardEnabled === false ? [] : projectedMatches;
    return NextResponse.json({ event: settings ? { name: settings.eventName, date: settings.eventDate, timezone: settings.eventTimezone, startTime: settings.startTime, endTime: settings.endTime, status: settings.lifecycleStatus } : null, teams: settings?.publicLeaderboardEnabled === false ? [] : rankedTeams, games: games.map((game: { name: string; station?: string }) => ({ name: game.name, station: game.station || null })), matches: competitionMatches, boardGames: publicBoardGames, soloActivities: soloActivities.map((activity: { name: string; description: string; rules: string; station: string; capacity?: number | null; seatsTaken?: number }) => ({ name: activity.name, description: activity.description, rules: activity.rules, station: activity.station, capacity: activity.capacity ?? null, availableSeats: activity.capacity == null ? null : Math.max(0, activity.capacity - (activity.seatsTaken ?? 0)) })), announcements, finalReveal, stats: { teams: teamCount, games: gameCount, students: studentCount, completedMatches: doneCount, totalMatches: projectedMatches.length }, leaderboardEnabled: settings?.publicLeaderboardEnabled !== false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Event data is not available" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
