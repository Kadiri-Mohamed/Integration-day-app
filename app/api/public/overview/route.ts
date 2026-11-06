import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { Clue, Game, Match, Student, Team } from "@/lib/models";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await connectDb();
    const [teams, games, matches, teamCount, gameCount, studentCount, doneCount] = await Promise.all([
      Team.find().sort({ name: 1 }).lean(), Game.find({ active: true, category: "COMPETITIVE" }).select("name frozen").sort({ name: 1 }).lean(), Match.find().populate("game", "name").populate("teams", "name slug color").populate("winner", "name").sort({ round: 1 }).lean(), Team.countDocuments(), Game.countDocuments({ active: true, category: "COMPETITIVE", frozen: false }), Student.countDocuments(), Match.countDocuments({ status: "DONE" }),
    ]);
    const counts = await Clue.aggregate([{ $group: { _id: "$team", count: { $sum: 1 } } }]);
    const clueMap = new Map(counts.map((entry: { _id: unknown; count: number }) => [String(entry._id), entry.count]));
    const publicTeams = teams.map((team: { _id: unknown; name: string; slug: string; color: string }) => {
      const related = matches.filter((match: { teams?: { _id: unknown }[] }) => match.teams?.some((entry) => String(entry._id) === String(team._id)));
      const current = related.find((match: { status: string }) => match.status === "IN_PROGRESS") ?? related.find((match: { status: string }) => match.status === "PENDING");
      return { id: String(team._id), name: team.name, slug: team.slug, color: team.color, clues: clueMap.get(String(team._id)) ?? 0, progress: related.filter((match: { status: string }) => match.status === "DONE").length, total: related.length, currentGame: (current?.game as { name?: string } | undefined)?.name ?? null, matchStatus: (current as { status?: string } | undefined)?.status ?? null };
    }).sort((a: { clues: number; name: string }, b: { clues: number; name: string }) => b.clues - a.clues || a.name.localeCompare(b.name));
    return NextResponse.json({ teams: publicTeams, games, matches, stats: { teams: teamCount, games: gameCount, students: studentCount, completedMatches: doneCount, totalMatches: matches.length } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Event data is not available" }, { status: 503 }); }
}
