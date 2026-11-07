import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Clue } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const correctionSchema = z.object({ content: z.string().trim().min(1).max(4000), reason: z.string().trim().min(5).max(1000) }).strict();
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "clue-correction", 10);
    const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const input = correctionSchema.parse(await request.json());
    await connectDb(); const session = await Clue.db.startSession();
    try { await session.withTransaction(async () => {
      const clue = await Clue.findById(id).session(session); if (!clue) throw new Error("NOT_FOUND"); if (clue.revealedAt) throw new Error("CLUE_ALREADY_REVEALED");
      const previous = { content: clue.content }; clue.content = input.content; await clue.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "CLUE_CORRECTED", targetType: "Clue", targetId: id, previous, next: { content: clue.content }, reason: input.reason }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ updated: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : message === "CLUE_ALREADY_REVEALED" ? 409 : 400 }); }
}
