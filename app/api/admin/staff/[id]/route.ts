import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AdminGuard, AuditLog, GameAssignment, StaffUser } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { actorMayManageStaff, staffUpdateSchema } from "@/lib/admin-validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "staff-update", 30); const { id } = await params;
    if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const patch = staffUpdateSchema.parse(await request.json());
    if (actor.id === id && (patch.role !== undefined || patch.active !== undefined)) throw new Error("SELF_ROLE_CHANGE");
    await connectDb(); const session = await StaffUser.db.startSession(); let updated: unknown;
    try { await session.withTransaction(async () => {
      const target = await StaffUser.findById(id).session(session); if (!target) throw new Error("NOT_FOUND");
      if (!actorMayManageStaff(actor.role, target.role) || (actor.role === "ADMIN" && patch.role && patch.role !== "GAME_MASTER")) throw new Error("FORBIDDEN");
      const nextRole = patch.role ?? target.role; const nextActive = patch.active ?? target.active;
      await AdminGuard.updateOne({ key: "global" }, { $inc: { version: 1 } }, { upsert: true, session });
      if (target.role === "SUPER_ADMIN" && target.active && (nextRole !== "SUPER_ADMIN" || !nextActive) && await StaffUser.countDocuments({ role: "SUPER_ADMIN", active: true }).session(session) <= 1) throw new Error("LAST_SUPER_ADMIN");
      const before = { name: target.name, email: target.email, role: target.role, active: target.active };
      Object.assign(target, patch); if (patch.role !== undefined || patch.active !== undefined) target.sessionVersion += 1; await target.save({ session });
      if (!target.active || target.role !== "GAME_MASTER") await GameAssignment.updateMany({ staffUser: target._id, active: true }, { $set: { active: false } }, { session });
      await AuditLog.create([{ actor: actor.id, action: "STAFF_UPDATED", targetType: "StaffUser", targetId: target.id, previous: before, next: { name: target.name, email: target.email, role: target.role, active: target.active } }], { session }); updated = { id: target.id, name: target.name, email: target.email, role: target.role, active: target.active };
    }); } finally { await session.endSession(); }
    return NextResponse.json({ staff: updated });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: ["FORBIDDEN", "UNAUTHENTICATED"].includes(message) ? message === "FORBIDDEN" ? 403 : 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : ["LAST_SUPER_ADMIN", "SELF_ROLE_CHANGE", "CROSS_ORIGIN_REQUEST"].includes(message) ? 409 : 400 }); }
}
