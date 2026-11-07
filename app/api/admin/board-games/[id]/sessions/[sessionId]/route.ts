import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, BoardGameSession } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try { assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { id, sessionId } = await params; if (![id, sessionId].every(Types.ObjectId.isValid)) throw new Error("NOT_FOUND"); const { status } = schema.parse(await request.json()); await connectDb();
    const session = await BoardGameSession.db.startSession();
    try { await session.withTransaction(async () => {
      const record = await BoardGameSession.findOne({ _id: sessionId, boardGame: id }).session(session); if (!record) throw new Error("NOT_FOUND");
      const allowed = record.status === "SCHEDULED" ? ["IN_PROGRESS", "CANCELLED"] : record.status === "IN_PROGRESS" ? ["COMPLETED", "CANCELLED"] : [];
      if (!allowed.includes(status)) throw new Error("INVALID_STATE");
      const previous = record.status; record.status = status; if (status === "IN_PROGRESS") record.startedAt = new Date(); if (status === "COMPLETED") record.completedAt = new Date(); await record.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "BOARD_SESSION_STATUS_CHANGED", targetType: "BoardGameSession", targetId: sessionId, previous: { status: previous }, next: { status } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ status });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "INVALID_STATE" ? 409 : 400 }); }
}
