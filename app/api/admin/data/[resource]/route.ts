import { NextResponse } from "next/server";
import mongoose, { type Model } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { AuditLog, BoardGame, BoardGameAssignment, Clue, ClueTemplate, EventAnnouncement, EventSettings, Game, Match, Rotation, RotationSlot, SoloActivity, SoloParticipation, StaffUser, Student, Team } from "@/lib/models";
import { eventSettingsInputSchema, gameInputSchema } from "@/lib/domain/validation";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";
import { sanitizeAuditValue } from "@/lib/domain/reporting";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const schemas: Record<string, z.ZodTypeAny> = {
  teams: z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9-]+$/i), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb"), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"), locked: z.boolean().default(false) }).strict(),
  games: gameInputSchema,
  slots: z.object({ rotation: id, sequence: z.number().int().min(1), label: z.string().max(100).default(""), kind: z.enum(["GAME", "BREAK", "BYE", "WAITING"]).default("GAME"), startAt: z.coerce.date().nullable().default(null), endAt: z.coerce.date().nullable().default(null), status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]).default("PLANNED") }).strict(),
  clueTemplates: z.object({ game: id, content: z.string().trim().min(1).max(4000), priority: z.number().int().min(0).default(100), active: z.boolean().default(true) }).strict(),
  boardGames: z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(4000).default(""), rules: z.string().max(8000).default(""), station: z.string().max(120).default(""), capacity: z.number().int().min(1).max(1000).default(1), participationMode: z.enum(["TEAM_COMPETITION", "RECREATIONAL"]).default("RECREATIONAL"), game: id.nullable().default(null), supervisors: z.array(id).default([]), active: z.boolean().default(true) }).strict(),
  soloActivities: z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(4000).default(""), rules: z.string().max(8000).default(""), game: id.nullable().default(null), boardGame: id.nullable().default(null), rotationSlot: id.nullable().default(null), capacity: z.number().int().min(1).max(1000).nullable().default(null), station: z.string().max(120).default(""), supervisors: z.array(id).default([]), available: z.boolean().default(true), awardsClues: z.boolean().default(false), active: z.boolean().default(true) }).strict(),
  soloParticipations: z.object({ activity: id, student: id, status: z.enum(["REGISTERED", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"]).default("REGISTERED") }).strict(),
  boardAssignments: z.object({ boardGame: id, rotationSlot: id.nullable().default(null), team: id.nullable().default(null), match: id.nullable().default(null), status: z.enum(["ASSIGNED", "IN_PROGRESS", "DONE", "CANCELLED"]).default("ASSIGNED") }).strict(),
  settings: eventSettingsInputSchema,
  announcements: z.object({ title: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(4000), active: z.boolean().default(true), startsAt: z.coerce.date().nullable().default(null), endsAt: z.coerce.date().nullable().default(null) }).strict().refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, "Announcement end must follow its start"),
};
type AdminModel = Model<Record<string, unknown>>;
const adminModel = (model: unknown) => model as AdminModel;
const resources: Record<string, { model: AdminModel; operation: string }> = {
  teams: { model: adminModel(Team), operation: "teams" }, games: { model: adminModel(Game), operation: "games" },
  clueTemplates: { model: adminModel(ClueTemplate), operation: "clues" }, clues: { model: adminModel(Clue), operation: "clues" }, matches: { model: adminModel(Match), operation: "matches" }, boardGames: { model: adminModel(BoardGame), operation: "boardGames" }, soloActivities: { model: adminModel(SoloActivity), operation: "soloActivities" },
  soloParticipations: { model: adminModel(SoloParticipation), operation: "soloActivities" }, boardAssignments: { model: adminModel(BoardGameAssignment), operation: "boardGames" }, settings: { model: adminModel(EventSettings), operation: "settings" }, announcements: { model: adminModel(EventAnnouncement), operation: "settings" },
};
const actorTypes = ["SUPER_ADMIN", "ADMIN"];
const jsonValue = (v: unknown) => JSON.parse(JSON.stringify(v));

async function validateReferences(resource: string, value: Record<string, unknown>, session: mongoose.ClientSession) {
  const exists = async (model: AdminModel, key: string) => !value[key] || Boolean(await model.exists({ _id: value[key] }).session(session));
  if (resource === "slots" && !await exists(adminModel(Rotation), "rotation")) throw new Error("INVALID_REFERENCE");
  if (resource === "clueTemplates" && !await exists(adminModel(Game), "game")) throw new Error("INVALID_REFERENCE");
  if (resource === "boardGames" && (!await exists(adminModel(Game), "game") || value.game && !await Game.exists({ _id: value.game, category: "BOARD" }).session(session))) throw new Error("INVALID_REFERENCE");
  if (resource === "soloActivities" && (!await exists(adminModel(Game), "game") || value.game && !await Game.exists({ _id: value.game, category: "SOLO" }).session(session) || !await exists(adminModel(BoardGame), "boardGame") || !await exists(adminModel(RotationSlot), "rotationSlot"))) throw new Error("INVALID_REFERENCE");
  if (["boardGames", "soloActivities"].includes(resource) && Array.isArray(value.supervisors) && await StaffUser.countDocuments({ _id: { $in: value.supervisors }, active: true }).session(session) !== new Set(value.supervisors.map(String)).size) throw new Error("INVALID_SUPERVISOR");
  if (resource === "soloParticipations") {
    const [activity, student] = await Promise.all([SoloActivity.findById(value.activity).session(session), Student.findById(value.student).session(session)]);
    if (!activity?.active || !student || student.mode !== "SOLO" || student.status !== "ACTIVE") throw new Error("INVALID_REFERENCE");
    if (value.status === "REGISTERED" && await SoloParticipation.countDocuments({ activity: value.activity, status: { $in: ["REGISTERED", "IN_PROGRESS"] } }).session(session) >= activity.capacity) throw new Error("CAPACITY_REACHED");
  }
  if (resource === "boardAssignments" && (!await exists(adminModel(BoardGame), "boardGame") || !await exists(adminModel(RotationSlot), "rotationSlot") || !await exists(adminModel(Team), "team") || !await exists(adminModel(Match), "match"))) throw new Error("INVALID_REFERENCE");
}

export async function GET(_: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params; const actor = await requireStaff(actorTypes);
    if (resource === "reports") {
      await connectDb();
      const [participants, teams, games, matches, clues] = await Promise.all([Student.countDocuments({ status: "ACTIVE" }), Team.countDocuments({ status: "ACTIVE" }), Game.countDocuments({ active: true }), Match.countDocuments(), Clue.countDocuments()]);
      const statuses = await Match.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
      return NextResponse.json({ participants, teams, games, matches, clues, matchStatuses: statuses });
    }
    if (resource === "audit") { await connectDb(); const logs = await AuditLog.find().sort({ occurredAt: -1 }).limit(500).populate("actor", "name role").lean(); return NextResponse.json({ items: sanitizeAuditValue(logs) }, { headers: { "Cache-Control": "private, no-store" } }); }
    const config = resources[resource]; if (!config) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (["settings", "announcements"].includes(resource) && actor.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
    await connectDb();
    const query = config.model.find(resource === "matches" ? { status: { $ne: "CANCELLED" } } : {}).sort({ createdAt: -1 }).limit(500);
    const items = resource === "settings" ? await config.model.findOne({ key: "event" }).lean() : resource === "matches" ? await query.populate("game", "name station").populate("teams", "name slug").populate("winner", "name").lean() : await query.lean();
    return NextResponse.json({ items });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 503 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(actorTypes); const { resource } = await params;
    if (resource === "matches") { const { createMatch } = await import("@/lib/domain/matches"); const match = await createMatch(await request.json()) as { id: string; status: string }; return NextResponse.json({ id: match.id, status: match.status }, { status: 201 }); }
    const config = resources[resource]; if (!config || !schemas[resource] || resource === "audit" || resource === "clues" || resource === "rotations" || resource === "slots" || resource === "boardAssignments" || resource === "soloParticipations") throw new Error("NOT_FOUND");
    if (["settings", "announcements"].includes(resource) && actor.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
    await assertSensitiveRateLimit(actor.id, `create-${resource}`); const value = schemas[resource].parse(await request.json()) as Record<string, unknown>;
    await connectDb(); const session = await config.model.db.startSession(); let itemId = "";
    try { await session.withTransaction(async () => {
      await validateReferences(resource, value, session);
      if (resource === "games") await touchScheduleGuard(session);
      const payload = resource === "teams" ? { ...value, nameKey: String(value.name).normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() } : value;
      const [doc] = resource === "settings" ? [await EventSettings.findOneAndUpdate({ key: "event" }, { $set: { ...payload, key: "event" } }, { upsert: true, new: true, runValidators: true, session })] : await config.model.create([resource === "announcements" ? { ...payload, createdBy: actor.id, updatedBy: actor.id } : payload], { session });
      itemId = String(doc._id); await AuditLog.create([{ actor: actor.id, action: `${resource.toUpperCase()}_CREATED`, targetType: config.model.modelName, targetId: itemId, next: jsonValue(doc.toObject()) }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ id: itemId }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : ["NOT_FOUND", "INVALID_REFERENCE"].includes(message) ? 404 : message === "RATE_LIMITED" ? 429 : ["GAME_FROZEN","GAME_UNAVAILABLE","GAME_MODE_MISMATCH","INVALID_TEAM_COUNT","INVALID_MATCH_TEAMS","INVALID_GAME_MASTER","ROTATION_UNAVAILABLE","INVALID_ROTATION_SLOT","IDEMPOTENCY_KEY_REUSED"].includes(message) ? 409 : 400 }); }
}
