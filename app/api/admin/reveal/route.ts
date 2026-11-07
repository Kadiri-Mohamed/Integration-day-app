import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Clue, EventSettings, Game, Match } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { validateRevealReadiness } from "@/lib/domain/reveal-policy";

const draftSchema = z.object({ content: z.string().trim().min(1).max(8000) }).strict();
const publishSchema = z.object({ confirmEventName: z.string().trim().min(1) }).strict();

async function revealReadiness() {
  const settings = await EventSettings.findOne({ key: "event" }).select("eventName finalClueRevealEnabled lifecycleStatus revealStatus revealContent revealedAt").lean();
  if (!settings) throw new Error("SETTINGS_NOT_FOUND");
  const clueAwardingGames = await Game.find({ awardsClues: true }).distinct("_id");
  const completed = await Match.countDocuments({ game: { $in: clueAwardingGames }, status: "DONE" });
  const awarded = await Clue.countDocuments({ game: { $in: clueAwardingGames }, voidedAt: null });
  const validation = validateRevealReadiness({ enabled: settings.finalClueRevealEnabled, eventCompleted: settings.lifecycleStatus === "COMPLETED", completedClueMatches: completed, activeAwardedClues: awarded });
  return { settings, completed, awarded, valid: validation.allowed, errors: validation.errors };
}

export async function GET() {
  try {
    await requireStaff(["SUPER_ADMIN"]); await connectDb();
    const state = await revealReadiness();
    return NextResponse.json({ eventName: state.settings.eventName, draft: { content: state.settings.revealContent, status: state.settings.revealStatus, revealedAt: state.settings.revealedAt }, preview: state.settings.revealContent, validation: { allowed: state.valid, finalClueRevealEnabled: state.settings.finalClueRevealEnabled, eventCompleted: state.settings.lifecycleStatus === "COMPLETED", completedClueMatches: state.completed, awardedClues: state.awarded, errors: state.errors } });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 400 }); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN"]); await assertSensitiveRateLimit(actor.id, "final-reveal-draft", 10);
    const { content } = draftSchema.parse(await request.json()); await connectDb();
    const settings = await EventSettings.findOne({ key: "event" }); if (!settings) throw new Error("SETTINGS_NOT_FOUND");
    if (settings.revealStatus === "PUBLISHED") throw new Error("REVEAL_ALREADY_PUBLISHED");
    const session = await EventSettings.db.startSession();
    try { await session.withTransaction(async () => {
      const current = await EventSettings.findOne({ key: "event" }).session(session); if (!current) throw new Error("SETTINGS_NOT_FOUND");
      if (current.revealStatus === "PUBLISHED") throw new Error("REVEAL_ALREADY_PUBLISHED");
      const previous = { content: current.revealContent, status: current.revealStatus };
      current.revealContent = content; current.revealStatus = "DRAFT"; await current.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "FINAL_REVEAL_DRAFT_UPDATED", targetType: "Event", targetId: "event", previous, next: { content, status: "DRAFT" } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ saved: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "REVEAL_ALREADY_PUBLISHED" ? 409 : 400 }); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN"]); await assertSensitiveRateLimit(actor.id, "final-clue-reveal", 3);
    const { confirmEventName } = publishSchema.parse(await request.json()); await connectDb();
    const session = await EventSettings.db.startSession(); let publishedAt: Date | null = null;
    try { await session.withTransaction(async () => {
      const settings = await EventSettings.findOne({ key: "event" }).session(session);
      if (!settings || !settings.finalClueRevealEnabled || settings.lifecycleStatus !== "COMPLETED" || !settings.revealContent.trim() || settings.revealStatus === "PUBLISHED" || confirmEventName !== settings.eventName) throw new Error("REVEAL_NOT_ALLOWED");
      const clueAwardingGames = await Game.find({ awardsClues: true }).distinct("_id").session(session);
      const completed = await Match.countDocuments({ game: { $in: clueAwardingGames }, status: "DONE" }).session(session);
      const awarded = await Clue.countDocuments({ game: { $in: clueAwardingGames }, voidedAt: null }).session(session);
      if (!completed || completed !== awarded) throw new Error("REVEAL_VALIDATION_FAILED");
      const previous = { status: settings.revealStatus, revealedAt: settings.revealedAt };
      publishedAt = new Date(); settings.revealStatus = "PUBLISHED"; settings.revealedAt = publishedAt; settings.revealedBy = actor.id; await settings.save({ session });
      await AuditLog.create([{ actor: actor.id, action: "FINAL_REVEAL_PUBLISHED", targetType: "Event", targetId: "event", previous, next: { status: "PUBLISHED", revealedAt: publishedAt, content: settings.revealContent } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ published: true, revealedAt: publishedAt });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : ["REVEAL_NOT_ALLOWED", "REVEAL_VALIDATION_FAILED"].includes(message) ? 409 : 400 }); }
}
