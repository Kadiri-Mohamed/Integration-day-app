import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, StaffUser } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { actorMayManageStaff, staffPasswordSchema } from "@/lib/admin-validation";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "staff-password-reset", 10); const { id } = await params;
    if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const { password } = staffPasswordSchema.parse(await request.json());
    await connectDb(); const session = await StaffUser.db.startSession();
    try { await session.withTransaction(async () => {
      const target = await StaffUser.findById(id).session(session); if (!target) throw new Error("NOT_FOUND");
      if (!actorMayManageStaff(actor.role, target.role) && actor.id !== id) throw new Error("FORBIDDEN");
      target.passwordHash = await hash(password, 12); target.sessionVersion += 1; await target.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "STAFF_PASSWORD_RESET", targetType: "StaffUser", targetId: id, reason: "Password reset by authorized staff" }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ ok: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: ["FORBIDDEN", "UNAUTHENTICATED"].includes(message) ? message === "FORBIDDEN" ? 403 : 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : 400 }); }
}
