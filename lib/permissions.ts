import { auth } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { AuditLog, Clue, ClueTemplate, Game, GameAssignment, Match, Rotation, StaffUser } from "@/lib/models";
import mongoose, { Types } from "mongoose";
import { assertSensitiveRateLimit } from "@/lib/security";
import { assertCompetitiveMatchGame, assertMatchOperationAccess, checkFinishIdempotency } from "@/lib/domain/match-policy";

export async function requireStaff(roles: string[]) {
  const session = await auth();
  if (!session?.user?.id || !Types.ObjectId.isValid(session.user.id)) throw new Error("UNAUTHENTICATED");
  await connectDb();
  const current = await StaffUser.findOne({ _id: session.user.id, active: true }).select("name email role sessionVersion").lean();
  if (!current) throw new Error("UNAUTHENTICATED");
  if ((current.sessionVersion ?? 0) !== (session.user.sessionVersion ?? 0)) throw new Error("UNAUTHENTICATED");
  if (!roles.includes(current.role)) throw new Error("FORBIDDEN");
  return { id: String(current._id), name: current.name, email: current.email, role: current.role };
}

async function authorizeGameMaster(gameId: Types.ObjectId | string, staff: { id: string; role: string }, operation: "matches.start"|"matches.finish", session: mongoose.ClientSession) {
  if (staff.role !== "GAME_MASTER") return;
  const assignments=await GameAssignment.find({staffUser:staff.id,active:true}).distinct("game").session(session);
  assertMatchOperationAccess(staff.role,assignments.map(String),String(gameId),operation);
}

export async function startMatch(matchId: string) {
  const staff = await requireStaff(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]);
  await assertSensitiveRateLimit(staff.id, "match-start", 60);
  if (!Types.ObjectId.isValid(matchId)) throw new Error("NOT_FOUND");
  await connectDb();
  const session = await Match.db.startSession();
  try {
    let result: unknown;
    await session.withTransaction(async () => {
      const match = await Match.findById(matchId).session(session);
      if (!match) throw new Error("NOT_FOUND");
      await authorizeGameMaster(match.game, staff, "matches.start", session);
      const key = `start:${matchId}`;
      if (match.status === "IN_PROGRESS" && match.transitionKeys.includes(key)) { result = match; return; }
      if (match.status !== "PENDING") throw new Error("INVALID_STATE");
      const game = await Game.findById(match.game).session(session);
      if (!game) throw new Error("GAME_UNAVAILABLE");
      const updated = await Match.findOneAndUpdate({ _id: match._id, status: "PENDING", transitionKeys: { $ne: key } }, { $set: { status: "IN_PROGRESS", startedAt: new Date() }, $addToSet: { transitionKeys: key }, $inc: { version: 1 } }, { new: true, session });
      if (!updated) throw new Error("INVALID_STATE");
      const [audit] = await AuditLog.create([{ actor: staff.id, action: "MATCH_STARTED", targetType: "Match", targetId: matchId, previous: { status: "PENDING" }, next: { status: "IN_PROGRESS" } }], { session });
      updated.auditRefs.push(audit._id); await updated.save({ session }); result = updated;
      if (updated.rotation) {
        const rotation = await Rotation.findOneAndUpdate({ _id: updated.rotation, status: "PUBLISHED" }, { $set: { status: "IN_PROGRESS" } }, { new: true, session });
        if (rotation) await AuditLog.create([{ actor: staff.id, action: "ROTATION_STARTED", targetType: "Rotation", targetId: String(rotation._id), previous: { status: "PUBLISHED" }, next: { status: "IN_PROGRESS" } }], { session });
      }
    });
    return result;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new Error("TEAM_ALREADY_IN_MATCH");
    throw error;
  } finally { await session.endSession(); }
}

export async function endMatch(matchId: string, winnerId: string, resultDetails?: string) {
  const staff = await requireStaff(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]);
  await assertSensitiveRateLimit(staff.id, "match-finish", 60);
  if (![matchId, winnerId].every(Types.ObjectId.isValid)) throw new Error("INVALID_INPUT");
  await connectDb();
  const session = await Match.db.startSession();
  try {
    let result: unknown;
    await session.withTransaction(async () => {
      const match = await Match.findById(matchId).session(session);
      if (!match) throw new Error("NOT_FOUND");
      await authorizeGameMaster(match.game, staff, "matches.finish", session);
      const normalizedWinnerId = new Types.ObjectId(winnerId).toString();
      const key = `end:${matchId}`;
      if (checkFinishIdempotency(match.status,(match.transitionKeys as string[]).map((entry:string)=>entry===key?"end":entry),String(match.winner??""),normalizedWinnerId)) { result = match; return; }
      if (!match.teams.some((id: Types.ObjectId) => String(id) === normalizedWinnerId)) throw new Error("INVALID_INPUT");
      const game = await Game.findById(match.game).session(session);
      if (!game) throw new Error("GAME_UNAVAILABLE");
      assertCompetitiveMatchGame(game.category, game.supportedModes);
      let clue: InstanceType<typeof Clue> | null = null;
      if (game.awardsClues) {
        const template = await ClueTemplate.findOneAndUpdate({ game: match.game, active: true, used: false, reservedFor: null }, { $set: { used: true, reservedFor: match._id } }, { new: true, session, sort: { priority: 1, createdAt: 1, _id: 1 } });
        if (!template) throw new Error("NO_CLUE_CONFIGURED");
        [clue] = await Clue.create([{ match: match._id, team: normalizedWinnerId, game: match.game, sourceTemplate: template._id, content: template.content, awardedBy: staff.id }], { session });
      }
      const normalizedDetails = resultDetails?.trim() || null;
      const updated = await Match.findOneAndUpdate({ _id: match._id, status: "IN_PROGRESS", transitionKeys: { $ne: key } }, { $set: { status: "DONE", winner: normalizedWinnerId, resultDetails: normalizedDetails, completedAt: new Date(), ...(clue ? { awardedClue: clue._id } : {}) }, $addToSet: { transitionKeys: key }, $inc: { version: 1 } }, { new: true, session });
      if (!updated) throw new Error("INVALID_STATE");
      const [audit] = await AuditLog.create([{ actor: staff.id, action: "MATCH_ENDED", targetType: "Match", targetId: matchId, previous: { status: "IN_PROGRESS" }, next: { status: "DONE", winner: normalizedWinnerId, resultDetails: normalizedDetails, clue: clue?._id ?? null } }], { session });
      updated.auditRefs.push(audit._id); await updated.save({ session }); result = updated;
      if (updated.rotation && await Match.countDocuments({ rotation: updated.rotation, status: { $in: ["PENDING", "IN_PROGRESS"] } }).session(session) === 0) {
        const rotation = await Rotation.findOneAndUpdate({ _id: updated.rotation, status: "IN_PROGRESS" }, { $set: { status: "COMPLETED" } }, { new: true, session });
        if (rotation) await AuditLog.create([{ actor: staff.id, action: "ROTATION_COMPLETED", targetType: "Rotation", targetId: String(rotation._id), previous: { status: "IN_PROGRESS" }, next: { status: "COMPLETED" } }], { session });
      }
    });
    return result;
  } finally { await session.endSession(); }
}

export async function cancelMatch(matchId: string, reason: string) {
  const staff = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  await assertSensitiveRateLimit(staff.id, "match-cancel", 20);
  if (!Types.ObjectId.isValid(matchId) || reason.trim().length < 5) throw new Error("INVALID_INPUT");
  await connectDb(); const session = await Match.db.startSession();
  try {
    let result: unknown;
    await session.withTransaction(async () => {
      const match = await Match.findById(matchId).session(session);
      if (!match) throw new Error("NOT_FOUND");
      const key = `cancel:${matchId}`;
      if (match.status === "CANCELLED" && match.transitionKeys.includes(key)) { result = match; return; }
      if (!["PENDING", "IN_PROGRESS"].includes(match.status)) throw new Error("INVALID_STATE");
      const previous = match.status;
      const updated = await Match.findOneAndUpdate({ _id: match._id, status: previous, transitionKeys: { $ne: key } }, { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() }, $addToSet: { transitionKeys: key }, $inc: { version: 1 } }, { new: true, session });
      if (!updated) throw new Error("INVALID_STATE");
      const [audit] = await AuditLog.create([{ actor: staff.id, action: "MATCH_CANCELLED", targetType: "Match", targetId: matchId, previous: { status: previous }, next: { status: "CANCELLED" }, reason: reason.trim() }], { session });
      updated.auditRefs.push(audit._id); await updated.save({ session }); result = updated;
      if (updated.rotation && await Match.countDocuments({ rotation: updated.rotation, status: { $in: ["PENDING", "IN_PROGRESS"] } }).session(session) === 0) {
        const priorRotation = await Rotation.findById(updated.rotation).select("status").session(session);
        const rotation = await Rotation.findOneAndUpdate({ _id: updated.rotation, status: { $in: ["PUBLISHED", "IN_PROGRESS", "ACTIVE"] } }, { $set: { status: "COMPLETED" } }, { new: true, session });
        if (rotation) await AuditLog.create([{ actor: staff.id, action: "ROTATION_COMPLETED", targetType: "Rotation", targetId: String(rotation._id), previous: { status: priorRotation?.status }, next: { status: "COMPLETED" } }], { session });
      }
    });
    return result;
  } finally { await session.endSession(); }
}
