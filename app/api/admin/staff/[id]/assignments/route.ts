import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, Game, GameAssignment, StaffUser } from "@/lib/models";
import { actorMayManageStaff, staffAssignmentsSchema } from "@/lib/admin-validation";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { requireStaff } from "@/lib/permissions";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "game-assignment", 30); const { id } = await params;
    if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const { gameIds } = staffAssignmentsSchema.parse(await request.json());
    await connectDb(); const session = await StaffUser.db.startSession(); let result: string[] = [];
    try { await session.withTransaction(async () => {
      const target = await StaffUser.findById(id).session(session); if (!target) throw new Error("NOT_FOUND");
      if (!actorMayManageStaff(actor.role, target.role) || target.role !== "GAME_MASTER") throw new Error("FORBIDDEN");
      if (gameIds.length && await Game.countDocuments({ _id: { $in: gameIds } }).session(session) !== gameIds.length) throw new Error("INVALID_ASSIGNMENTS");
      const previous = (await GameAssignment.find({ staffUser: target._id, active: true }).distinct("game").session(session)).map(String);
      await GameAssignment.updateMany({ staffUser: target._id, active: true, game: { $nin: gameIds } }, { $set: { active: false } }, { session });
      for (const gameId of gameIds) await GameAssignment.updateOne({ game: gameId, staffUser: target._id }, { $set: { active: true, assignedBy: actor.id, assignedAt: new Date() } }, { upsert: true, session });
      await AuditLog.create([{ actor: actor.id, action: "GAME_ASSIGNMENTS_CHANGED", targetType: "StaffUser", targetId: id, previous: { gameIds: previous }, next: { gameIds } }], { session }); result = gameIds;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ gameIds: result });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: ["FORBIDDEN", "UNAUTHENTICATED"].includes(message) ? message === "FORBIDDEN" ? 403 : 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : message === "CROSS_ORIGIN_REQUEST" ? 403 : 400 }); }
}
