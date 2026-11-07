import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, BoardGame, BoardGameSession, StaffUser } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const schema = z.object({ label: z.string().trim().max(120).default(""), startAt: z.coerce.date(), endAt: z.coerce.date(), capacity: z.number().int().min(1).max(1000), supervisors: z.array(z.string().regex(/^[a-f\d]{24}$/i)).default([]) }).strict().refine(v => v.endAt > v.startAt, "Session end must be after start");

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); await connectDb();
    const sessions = await BoardGameSession.find({ boardGame: id }).sort({ startAt: 1 }).populate("supervisors", "name").lean();
    return NextResponse.json({ sessions });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "board-session-create", 20); const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const input = schema.parse(await request.json()); await connectDb();
    const board = await BoardGame.findOne({ _id: id, active: true }); if (!board) throw new Error("ACTIVITY_UNAVAILABLE");
    if (input.supervisors.length && await StaffUser.countDocuments({ _id: { $in: input.supervisors }, active: true, role: { $in: ["ADMIN", "SUPER_ADMIN", "GAME_MASTER"] } }) !== new Set(input.supervisors).size) throw new Error("INVALID_SUPERVISOR");
    const dbSession = await BoardGameSession.db.startSession(); let sessionId = "";
    try { await dbSession.withTransaction(async () => { const [session] = await BoardGameSession.create([{ boardGame: id, ...input }], { session: dbSession }); sessionId = String(session._id); await AuditLog.create([{ actor: actor.id, action: "BOARD_SESSION_CREATED", targetType: "BoardGameSession", targetId: sessionId, next: { boardGame: id, label: session.label, startAt: session.startAt, endAt: session.endAt, capacity: session.capacity } }], { session: dbSession }); }); } finally { await dbSession.endSession(); }
    return NextResponse.json({ id: sessionId }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "ACTIVITY_UNAVAILABLE" ? 409 : 400 }); }
}
