import { NextResponse } from "next/server";
import { Types, type Model } from "mongoose";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { AuditLog, BoardGame, BoardGameAssignment, BoardGameSession, Clue, ClueTemplate, EventAnnouncement, EventSettings, Game, GameAssignment, Match, Rotation, RotationSlot, SoloActivity, SoloParticipation, StaffUser, Student, Team } from "@/lib/models";
import { participantUpdateSchema } from "@/lib/admin-validation";
import { eventSettingsInputSchema } from "@/lib/domain/validation";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";
import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const schemas: Record<string, z.ZodTypeAny> = {
  participants: participantUpdateSchema,
  teams: z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9-]+$/i), color: z.string().regex(/^#[0-9a-f]{6}$/i), status: z.enum(["ACTIVE", "INACTIVE"]), locked: z.boolean() }).strict(),
  games: z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(4000), rules: z.string().max(8000), category: z.enum(["COMPETITIVE", "BOARD", "SOLO"]), station: z.string().max(120), stationCapacity: z.number().int().min(1).max(1000).nullable(), active: z.boolean(), frozen: z.boolean(), supportedModes: z.array(z.enum(["TEAM", "SOLO"])).min(1), teamsPerMatch: z.number().int().min(1).max(100), awardsClues: z.boolean(), configuration: z.record(z.string(), z.unknown()) }).strict(),
  clueTemplates: z.object({ game: objectId, content: z.string().trim().min(1).max(4000), priority: z.number().int().min(0), active: z.boolean() }).strict(),
  boardGames: z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(4000), rules: z.string().max(8000), station: z.string().max(120), capacity: z.number().int().min(1).max(1000), participationMode: z.enum(["TEAM_COMPETITION", "RECREATIONAL"]), game: objectId.nullable(), supervisors: z.array(objectId), active: z.boolean() }).strict(),
  soloActivities: z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(4000), rules: z.string().max(8000), game: objectId.nullable(), boardGame: objectId.nullable(), rotationSlot: objectId.nullable(), capacity: z.number().int().min(1).max(1000).nullable(), station: z.string().max(120), supervisors: z.array(objectId), available: z.boolean(), awardsClues: z.boolean(), active: z.boolean() }).strict(),
  soloParticipations: z.object({ activity: objectId, student: objectId, status: z.enum(["REGISTERED", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"]) }).strict(),
  boardAssignments: z.object({ boardGame: objectId, rotationSlot: objectId.nullable(), team: objectId.nullable(), match: objectId.nullable(), status: z.enum(["ASSIGNED", "IN_PROGRESS", "DONE", "CANCELLED"]) }).strict(),
  settings: eventSettingsInputSchema,
  announcements: z.object({ title: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(4000), active: z.boolean(), startsAt: z.coerce.date().nullable().default(null), endsAt: z.coerce.date().nullable().default(null) }).strict().refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, "Announcement end must follow its start"),
};
const modelRef = (model: unknown) => model as Model<Record<string, unknown>>;
const models: Record<string, Model<Record<string, unknown>>> = { participants: modelRef(Student), teams: modelRef(Team), games: modelRef(Game), clueTemplates: modelRef(ClueTemplate), boardGames: modelRef(BoardGame), soloActivities: modelRef(SoloActivity), soloParticipations: modelRef(SoloParticipation), boardAssignments: modelRef(BoardGameAssignment), settings: modelRef(EventSettings), announcements: modelRef(EventAnnouncement) };
const stringify = (value: unknown) => JSON.parse(JSON.stringify(value));

async function hasDependencies(resource: string, id: string) {
  if (resource === "teams") return Boolean(await Match.exists({ teams: id }) || await RotationSlot.exists({ $or: [{ teams: id }, { waitingTeams: id }] }) || await Student.exists({ team: id }));
  if (resource === "games") return Boolean(await Match.exists({ game: id }) || await RotationSlot.exists({ game: id }) || await GameAssignment.exists({ game: id }) || await ClueTemplate.exists({ game: id }) || await BoardGame.exists({ game: id }));
  if (resource === "rotations") return Boolean(await RotationSlot.exists({ rotation: id }) || await Match.exists({ rotation: id }));
  if (resource === "slots") return Boolean(await Match.exists({ rotationSlot: id }) || await BoardGameAssignment.exists({ rotationSlot: id }) || await SoloActivity.exists({ rotationSlot: id }));
  if (resource === "clueTemplates") return Boolean(await Clue.exists({ sourceTemplate: id }));
  if (resource === "boardGames") return Boolean(await BoardGameSession.exists({ boardGame: id }) || await BoardGameAssignment.exists({ boardGame: id }) || await SoloActivity.exists({ boardGame: id }));
  if (resource === "soloActivities") return Boolean(await SoloParticipation.exists({ activity: id }));
  return false;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); const { resource, id } = await params;
    if (["settings", "announcements"].includes(resource) && actor.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
    const model = models[resource], schema = schemas[resource]; if (!model || !schema || ["boardAssignments", "soloParticipations"].includes(resource) || resource === "settings" && !id.match(/^(event|[a-f\d]{24})$/i)) throw new Error("NOT_FOUND");
    if (resource === "participants") {
      if (!Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND"); const patch = participantUpdateSchema.parse(await request.json());
      await connectDb(); const session = await Student.db.startSession(); let output: unknown;
      try { await session.withTransaction(async () => {
        const doc = await Student.findById(id).session(session); if (!doc) throw new Error("NOT_FOUND"); const previous = { fullName: doc.fullName, year: doc.year, className: doc.className, gender: doc.gender, mode: doc.mode, status: doc.status };
        if (patch.mode === "SOLO" && doc.team) { await Team.updateOne({ _id: doc.team }, { $pull: { members: doc._id } }, { session }); doc.team = null; }
        Object.assign(doc, patch); if (patch.fullName || patch.year || patch.className) { const { normalizeIdentityKey } = await import("@/lib/domain/identity.mjs"); doc.identityKey = normalizeIdentityKey({ fullName: doc.fullName, year: doc.year, className: doc.className }); }
        if (patch.status === "INACTIVE" && doc.team) { await Team.updateOne({ _id: doc.team }, { $pull: { members: doc._id } }, { session }); doc.team = null; }
        await touchScheduleGuard(session);
        await doc.save({ session }); await AuditLog.create([{ actor: actor.id, action: "PARTICIPANT_UPDATED", targetType: "Student", targetId: id, previous, next: { fullName: doc.fullName, year: doc.year, className: doc.className, gender: doc.gender, mode: doc.mode, status: doc.status } }], { session }); output = { id: doc.id, fullName: doc.fullName, status: doc.status };
      }); } finally { await session.endSession(); }
      return NextResponse.json({ participant: output });
    }
    await assertSensitiveRateLimit(actor.id, `update-${resource}`); const input = schema.parse(await request.json()) as Record<string, unknown>;
    await connectDb(); const session = await model.db.startSession(); let output: unknown;
    try { await session.withTransaction(async () => {
      const filter = resource === "settings" ? { key: "event" } : { _id: id };
      const doc = await model.findOne(filter).session(session); if (!doc) throw new Error("NOT_FOUND");
      if (resource === "games" && input.frozen === true && doc.frozen !== true) throw new Error("USE_FREEZE_IMPACT_CONFIRMATION");
      if (resource === "teams" && input.locked !== doc.locked) throw new Error("USE_TEAM_LOCK_WORKFLOW");
      if (resource === "teams" && doc.locked && input.status !== doc.status) throw new Error("TEAM_LOCKED");
      if (resource === "clueTemplates" && doc.used && input.content !== doc.content) throw new Error("TEMPLATE_ALREADY_USED");
      if (resource === "rotations" && ["COMPLETED", "CANCELLED"].includes(String(doc.status))) throw new Error("INVALID_STATE");
      if (resource === "slots" && !await Rotation.exists({ _id: input.rotation }).session(session)) throw new Error("INVALID_REFERENCE");
      if (resource === "clueTemplates" && !await Game.exists({ _id: input.game }).session(session)) throw new Error("INVALID_REFERENCE");
      if (resource === "boardGames" && input.game && !await Game.exists({ _id: input.game, category: "BOARD" }).session(session)) throw new Error("INVALID_REFERENCE");
      if (resource === "soloActivities" && ((!await Game.exists({ _id: input.game, category: "SOLO" }).session(session) && input.game) || (!await BoardGame.exists({ _id: input.boardGame }).session(session) && input.boardGame) || (!await RotationSlot.exists({ _id: input.rotationSlot }).session(session) && input.rotationSlot))) throw new Error("INVALID_REFERENCE");
      if (["boardGames", "soloActivities"].includes(resource) && Array.isArray(input.supervisors) && await StaffUser.countDocuments({ _id: { $in: input.supervisors }, active: true }).session(session) !== new Set((input.supervisors as string[]).map(String)).size) throw new Error("INVALID_SUPERVISOR");
      const previous = stringify(doc.toObject()); Object.assign(doc, input);
      if (["games", "teams"].includes(resource)) await touchScheduleGuard(session);
      if (resource === "teams") doc.nameKey = String(input.name).normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
      if (resource === "settings") doc.key = "event";
      if (resource === "announcements") doc.updatedBy = actor.id;
      await doc.save({ session }); await AuditLog.create([{ actor: actor.id, action: `${resource.toUpperCase()}_UPDATED`, targetType: model.modelName, targetId: String(doc._id), previous, next: stringify(doc.toObject()) }], { session });
      output = stringify(doc.toObject());
    }); } finally { await session.endSession(); }
    return NextResponse.json({ item: output });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : ["INVALID_STATE", "REMOVE_FROM_TEAM_FIRST", "TEMPLATE_ALREADY_USED", "USE_FREEZE_IMPACT_CONFIRMATION", "USE_TEAM_LOCK_WORKFLOW", "TEAM_LOCKED"].includes(message) ? 409 : 400 }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN"]); const { resource, id } = await params;
    if (["settings", "participants", "matches", "clues", "boardAssignments", "soloParticipations"].includes(resource)) throw new Error("NOT_FOUND");
    const model = models[resource]; if (!model || !Types.ObjectId.isValid(id)) throw new Error("NOT_FOUND");
    await assertSensitiveRateLimit(actor.id, `delete-${resource}`, 10); await connectDb(); const session = await model.db.startSession();
    try { await session.withTransaction(async () => {
      const doc = await model.findById(id).session(session); if (!doc) throw new Error("NOT_FOUND");
      if (await hasDependencies(resource, id)) throw new Error("RESOURCE_IN_USE");
      if (resource === "teams") await Student.updateMany({ team: id }, { $set: { team: null } }, { session });
      await AuditLog.create([{ actor: actor.id, action: `${resource.toUpperCase()}_DELETED`, targetType: model.modelName, targetId: id, previous: stringify(doc.toObject()), reason: "Deleted by SUPER_ADMIN" }], { session });
      await doc.deleteOne({ session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ deleted: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : message === "RESOURCE_IN_USE" ? 409 : 400 }); }
}
