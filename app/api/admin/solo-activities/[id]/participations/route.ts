import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, SoloActivity, SoloParticipation, Student } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const enrollSchema = z.object({ studentId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
const statusSchema = z.object({ participationId: z.string().regex(/^[a-f\d]{24}$/i), status: z.enum(["IN_PROGRESS", "COMPLETED", "WITHDRAWN"]) }).strict();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); await connectDb();
    const participations = await SoloParticipation.find({ activity: id }).populate("student", "fullName year className mode status").sort({ joinedAt: -1 }).lean(); return NextResponse.json({ participations });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "solo-enroll", 60); const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const { studentId } = enrollSchema.parse(await request.json()); await connectDb();
    const session = await SoloActivity.db.startSession();
    try { await session.withTransaction(async () => {
      const [activity, student] = await Promise.all([SoloActivity.findOne({ _id: id, active: true, available: true }).session(session), Student.findOne({ _id: studentId, status: "ACTIVE", mode: "SOLO", team: null }).session(session)]);
      if (!activity || !student) throw new Error("INVALID_REFERENCE");
      const existing = await SoloParticipation.findOne({ activity: id, student: studentId }).session(session);
      if (existing && existing.status !== "WITHDRAWN") throw new Error("ALREADY_ENROLLED");
      const capacityFilter = { _id: id, active: true, available: true, $or: [{ capacity: null }, { $expr: { $lt: ["$seatsTaken", "$capacity"] } }] };
      const reserved = await SoloActivity.findOneAndUpdate(capacityFilter, { $inc: { seatsTaken: 1 } }, { new: true, session });
      if (!reserved) throw new Error("CAPACITY_REACHED");
      let participationId: string;
      if (existing) { existing.status = "REGISTERED"; existing.leftAt = null; existing.joinedAt = new Date(); await existing.save({ session }); participationId = String(existing._id); }
      else { const [participation] = await SoloParticipation.create([{ activity: id, student: studentId, status: "REGISTERED" }], { session }); participationId = String(participation._id); }
      await AuditLog.create([{ actor: actor.id, action: "SOLO_PARTICIPANT_ENROLLED", targetType: "SoloParticipation", targetId: participationId, next: { activity: id, student: studentId } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ enrolled: true }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "INVALID_REFERENCE" ? 404 : ["ALREADY_ENROLLED", "CAPACITY_REACHED"].includes(message) ? 409 : 400 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const input = statusSchema.parse(await request.json()); await connectDb();
    const session = await SoloActivity.db.startSession();
    try { await session.withTransaction(async () => {
      const [activity, participation] = await Promise.all([SoloActivity.findById(id).session(session), SoloParticipation.findOne({ _id: input.participationId, activity: id }).session(session)]);
      if (!activity || !participation) throw new Error("NOT_FOUND"); const previous = participation.status;
      if (previous === "WITHDRAWN" || previous === "COMPLETED") throw new Error("INVALID_STATE");
      if (input.status === "WITHDRAWN") { await SoloActivity.updateOne({ _id: id, seatsTaken: { $gt: 0 } }, { $inc: { seatsTaken: -1 } }, { session }); participation.leftAt = new Date(); }
      participation.status = input.status; await participation.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "SOLO_PARTICIPATION_STATUS_CHANGED", targetType: "SoloParticipation", targetId: String(participation._id), previous: { status: previous }, next: { status: input.status } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ updated: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "INVALID_STATE" ? 409 : 400 }); }
}
