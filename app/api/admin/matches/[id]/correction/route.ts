import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Clue, ClueTemplate, Match } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const correction = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("CORRECT_RESULT"), winnerId: z.string().regex(/^[a-f\d]{24}$/i), resultDetails: z.string().trim().max(2000).optional(), clueContent: z.string().trim().min(1).max(4000).optional(), clueTeamId: z.string().regex(/^[a-f\d]{24}$/i).optional(), reason: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ operation: z.literal("REOPEN"), reason: z.string().trim().min(5).max(1000) }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "match-correction", 10);
    const { id } = await params; if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const input = correction.parse(await request.json()); await connectDb();
    const session = await Match.db.startSession();
    try { await session.withTransaction(async () => {
      const match = await Match.findById(id).session(session); if (!match || match.status !== "DONE") throw new Error("INVALID_STATE");
      const clue = match.awardedClue ? await Clue.findById(match.awardedClue).session(session) : null;
      const previous = { status: match.status, winner: match.winner, resultDetails: match.resultDetails, awardedClue: match.awardedClue, clueTeam: clue?.team ?? null, clueContent: clue?.content ?? null };
      if (input.operation === "REOPEN") {
        if (clue) { clue.voidedAt = new Date(); clue.voidedBy = new Types.ObjectId(actor.id); clue.voidReason = input.reason; await clue.save({ session }); await ClueTemplate.updateOne({ _id: clue.sourceTemplate, reservedFor: match._id }, { $set: { used: false, reservedFor: null } }, { session }); }
        match.status = "IN_PROGRESS"; match.winner = null; match.resultDetails = null; match.completedAt = null; match.awardedClue = null;
        match.transitionKeys = match.transitionKeys.filter((key: string) => key !== `end:${id}`);
      } else {
        if (!match.teams.some((team: Types.ObjectId) => String(team) === input.winnerId)) throw new Error("INVALID_WINNER");
        match.winner = new Types.ObjectId(input.winnerId); if (input.resultDetails !== undefined) match.resultDetails = input.resultDetails || null;
        if (clue && input.clueTeamId) { if (!match.teams.some((team: Types.ObjectId) => String(team) === input.clueTeamId)) throw new Error("INVALID_WINNER"); clue.team = new Types.ObjectId(input.clueTeamId); }
        if (clue && input.clueContent) clue.content = input.clueContent;
        if (clue) await clue.save({ session });
      }
      await match.save({ session });
      const next = { status: match.status, winner: match.winner, resultDetails: match.resultDetails, awardedClue: match.awardedClue, clueTeam: input.operation === "CORRECT_RESULT" ? input.clueTeamId ?? previous.clueTeam : null, clueContent: input.operation === "CORRECT_RESULT" ? input.clueContent ?? previous.clueContent : null };
      const [audit] = await AuditLog.create([{ actor: actor.id, action: input.operation === "REOPEN" ? "MATCH_REOPENED_CORRECTION" : "MATCH_RESULT_CORRECTED", targetType: "Match", targetId: id, previous, next, reason: input.reason }], { session });
      match.auditRefs.push(audit._id); await match.save({ session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ corrected: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : ["INVALID_STATE", "INVALID_WINNER"].includes(message) ? 409 : 400 }); }
}
