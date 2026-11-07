import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, BoardGame, BoardGameAssignment, BoardGameSession, Student } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const schema = z.object({ studentId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export async function GET(_: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try { await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { id, sessionId } = await params; if (![id, sessionId].every(Types.ObjectId.isValid)) throw new Error("NOT_FOUND"); await connectDb();
    const participants = await BoardGameAssignment.find({ boardGame: id, session: sessionId }).populate("student", "fullName year className mode").sort({ createdAt: 1 }).lean(); return NextResponse.json({ participants });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 400 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try { assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "board-session-enroll", 60); const { id, sessionId } = await params; if (![id, sessionId].every(Types.ObjectId.isValid)) throw new Error("NOT_FOUND"); const { studentId } = schema.parse(await request.json()); await connectDb();
    const dbSession = await BoardGameSession.db.startSession();
    try { await dbSession.withTransaction(async () => {
      const [board, student] = await Promise.all([BoardGame.findOne({ _id: id, active: true }).session(dbSession), Student.findOne({ _id: studentId, status: "ACTIVE" }).session(dbSession)]);
      if (!board || !student) throw new Error("INVALID_REFERENCE");
      if (await BoardGameAssignment.exists({ session: sessionId, student: studentId }).session(dbSession)) throw new Error("ALREADY_ENROLLED");
      const session = await BoardGameSession.findOneAndUpdate({ _id: sessionId, boardGame: id, status: { $in: ["SCHEDULED", "IN_PROGRESS"] }, $expr: { $lt: ["$seatsTaken", "$capacity"] } }, { $inc: { seatsTaken: 1 } }, { new: true, session: dbSession });
      if (!session) throw new Error("SESSION_FULL_OR_CLOSED");
      const [assignment] = await BoardGameAssignment.create([{ boardGame: id, session: sessionId, student: studentId, status: "ASSIGNED" }], { session: dbSession });
      await AuditLog.create([{ actor: actor.id, action: "BOARD_PARTICIPANT_ENROLLED", targetType: "BoardGameAssignment", targetId: String(assignment._id), next: { boardGame: id, session: sessionId, student: studentId } }], { session: dbSession });
    }); } finally { await dbSession.endSession(); }
    return NextResponse.json({ enrolled: true }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "INVALID_REFERENCE" ? 404 : ["ALREADY_ENROLLED", "SESSION_FULL_OR_CLOSED"].includes(message) ? 409 : 400 }); }
}
