import { auth } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { AuditLog, Clue, ClueTemplate, Match } from "@/lib/models";
import { Types } from "mongoose";

export async function requireStaff(roles: string[]) {
  const session = await auth();
  if (!session?.user?.id || !roles.includes(session.user.role)) throw new Error("FORBIDDEN");
  return session.user;
}

export async function startMatch(matchId: string) {
  const staff = await requireStaff(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]);
  if (!Types.ObjectId.isValid(matchId)) throw new Error("NOT_FOUND");
  await connectDb();
  const match = await Match.findById(matchId).populate("game");
  if (!match) throw new Error("NOT_FOUND");
  if (staff.role === "GAME_MASTER" && !(match.game as unknown as { masters: Types.ObjectId[] }).masters.some((id) => String(id) === staff.id)) throw new Error("FORBIDDEN");
  if (match.status !== "PENDING") throw new Error("INVALID_STATE");
  const updated = await Match.findOneAndUpdate({ _id: match._id, status: "PENDING" }, { $set: { status: "IN_PROGRESS", startedAt: new Date() } }, { new: true });
  if (!updated) throw new Error("INVALID_STATE");
  await AuditLog.create({ actor: staff.id, action: "MATCH_STARTED", targetType: "Match", targetId: matchId, previous: { status: "PENDING" }, next: { status: "IN_PROGRESS" } });
  return updated;
}

export async function endMatch(matchId: string, winnerId: string) {
  const staff = await requireStaff(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]);
  if (![matchId, winnerId].every(Types.ObjectId.isValid)) throw new Error("INVALID_INPUT");
  await connectDb();
  const match = await Match.findById(matchId).populate("game");
  if (!match || match.status !== "IN_PROGRESS") throw new Error("INVALID_STATE");
  if (!match.teams.some((id: Types.ObjectId) => String(id) === winnerId)) throw new Error("INVALID_INPUT");
  const game = match.game as unknown as { masters: Types.ObjectId[] };
  if (staff.role === "GAME_MASTER" && !game.masters.some((id) => String(id) === staff.id)) throw new Error("FORBIDDEN");
  const session = await Match.db.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const template = await ClueTemplate.findOneAndUpdate({ game: match.game._id, used: false }, { $set: { used: true } }, { new: true, session });
      if (!template) throw new Error("NO_CLUE_CONFIGURED");
      result = await Match.findOneAndUpdate({ _id: match._id, status: "IN_PROGRESS", winner: null }, { $set: { status: "DONE", winner: winnerId, completedAt: new Date() } }, { new: true, session });
      if (!result) throw new Error("INVALID_STATE");
      await Clue.create([{ match: match._id, team: winnerId, content: template.content }], { session });
      await AuditLog.create([{ actor: staff.id, action: "MATCH_ENDED", targetType: "Match", targetId: matchId, previous: { status: "IN_PROGRESS" }, next: { status: "DONE", winner: winnerId } }], { session });
    });
    return result;
  } finally { await session.endSession(); }
}
