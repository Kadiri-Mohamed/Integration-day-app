import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, SoloParticipation, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { participantUpdateSchema } from "@/lib/admin-validation";
import { normalizeIdentityKey } from "@/lib/domain/identity.mjs";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "participant-update");
    const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND");
    const patch = participantUpdateSchema.parse(await request.json()); await connectDb(); const session = await Student.db.startSession(); let result: unknown;
    try { await session.withTransaction(async () => {
      const student = await Student.findById(id).session(session); if (!student) throw new Error("NOT_FOUND");
      const previous = { fullName: student.fullName, year: student.year, className: student.className, gender: student.gender, mode: student.mode, status: student.status, team: student.team ? String(student.team) : null };
      Object.assign(student, patch);
      if (patch.fullName || patch.year || patch.className) student.identityKey = normalizeIdentityKey({ fullName: student.fullName, year: student.year, className: student.className });
      if ((patch.mode === "SOLO" || patch.status === "INACTIVE") && student.team) {
        if (await Team.exists({ _id: student.team, locked: true }).session(session)) throw new Error("TEAM_LOCKED");
        await Team.updateOne({ _id: student.team }, { $pull: { members: student._id } }, { session }); student.team = null;
      }
      await student.save({ session });
      const next = { fullName: student.fullName, year: student.year, className: student.className, gender: student.gender, mode: student.mode, status: student.status, team: student.team ? String(student.team) : null };
      await AuditLog.create([{ actor: actor.id, action: patch.status === "INACTIVE" ? "PARTICIPANT_DEACTIVATED" : "PARTICIPANT_UPDATED", targetType: "Student", targetId: id, previous, next }], { session }); result = next;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ participant: result });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const duplicate = error && typeof error === "object" && "code" in error && error.code === 11000; return NextResponse.json({ error: duplicate ? "DUPLICATE_PARTICIPANT" : message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : duplicate || message === "TEAM_LOCKED" ? 409 : 400 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN"]); await assertSensitiveRateLimit(actor.id, "participant-delete", 10);
    const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); await connectDb(); const session = await Student.db.startSession();
    try { await session.withTransaction(async () => {
      const student = await Student.findById(id).session(session); if (!student) throw new Error("NOT_FOUND");
      if (student.status !== "INACTIVE" || student.team) throw new Error("DEACTIVATE_AND_REMOVE_FROM_TEAM_FIRST");
      if (await SoloParticipation.exists({ student: student._id }).session(session)) throw new Error("PARTICIPANT_HAS_HISTORY");
      const previous = { fullName: student.fullName, year: student.year, className: student.className, mode: student.mode };
      await AuditLog.create([{ actor: actor.id, action: "PARTICIPANT_DELETED", targetType: "Student", targetId: id, previous, reason: "Authorized safe deletion" }], { session }); await student.deleteOne({ session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ deleted: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : ["DEACTIVATE_AND_REMOVE_FROM_TEAM_FIRST","PARTICIPANT_HAS_HISTORY"].includes(message) ? 409 : 400 }); }
}
