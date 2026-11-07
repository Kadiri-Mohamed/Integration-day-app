import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Student, Team, Match, RotationSlot, SoloActivity, BoardGameSession, BoardGameAssignment, SoloParticipation, AuditLog } from "../models";
import { normalizeIdentityKey } from "./identity.mjs";
import { eventSettingsInputSchema, gameInputSchema, participantInputSchema, matchCreateSchema } from "./validation";

async function errorsOf(document: { validate: () => Promise<unknown> }) {
  try { await document.validate(); return {}; } catch (error) { return (error as { errors: Record<string, unknown> }).errors; }
}

describe("domain model constraints", () => {
  it("normalizes participant identities across case, Unicode form and whitespace", () => {
    expect(normalizeIdentityKey({ fullName: "  José  Ben  ", year: "A1", className: " CS 1 " })).toBe(normalizeIdentityKey({ fullName: "Jose\u0301 Ben", year: "A1", className: "cs 1" }));
  });
  it("validates participant fields and creates normalized identity", () => {
    const value = participantInputSchema.parse({ fullName: "  Alex Doe ", year: "A2", className: "G1", mode: "SOLO" });
    expect(value.identityKey).toBe(normalizeIdentityKey(value)); expect(participantInputSchema.safeParse({ ...value, year: "B1" }).success).toBe(false);
  });
  it("rejects SOLO participants with team references", async () => {
    const errors = await errorsOf(new Student({ fullName: "Solo Person", identityKey: "x", year: "A1", className: "A", mode: "SOLO", team: new Types.ObjectId() }));
    expect(errors.team).toBeDefined();
  });
  it("requires unique team members and match participants", async () => {
    const id = new Types.ObjectId();
    expect((await errorsOf(new Team({ name: "T", slug: "t", members: [id, id] }))).members).toBeDefined();
    const match = new Match({ game: id, teams: [id], status: "DONE", winner: new Types.ObjectId(), completedAt: new Date() });
    expect((await errorsOf(match)).winner).toBeDefined();
  });
  it("checks game category and event time rules", () => {
    expect(gameInputSchema.safeParse({ name: "Solo", category: "SOLO", supportedModes: ["TEAM"] }).success).toBe(false);
    expect(eventSettingsInputSchema.safeParse({ eventName: "Day", rotationCount: 0, rotationDurationMinutes: 20, startTime: "12:00", endTime: "10:00" }).success).toBe(false);
  });
  it("validates rotation slots, activities and match idempotency inputs", async () => {
    const id = new Types.ObjectId();
    expect((await errorsOf(new RotationSlot({ rotation: id, sequence: 1, startAt: new Date("2026-01-02"), endAt: new Date("2026-01-01") }))).endAt).toBeDefined();
    expect((await errorsOf(new SoloActivity({ name: "Free", capacity: 1, seatsTaken: 2 }))).seatsTaken).toBeDefined();
    expect((await errorsOf(new SoloActivity({ name: "Free", capacity: null, seatsTaken: 2 }))).seatsTaken).toBeUndefined();
    expect((await errorsOf(new BoardGameSession({ boardGame: id, startAt: new Date("2026-01-02"), endAt: new Date("2026-01-01"), capacity: 2 }))).endAt).toBeDefined();
    expect((await errorsOf(new BoardGameSession({ boardGame: id, startAt: new Date("2026-01-01"), endAt: new Date("2026-01-02"), capacity: 1, seatsTaken: 2 }))).seatsTaken).toBeDefined();
    expect(matchCreateSchema.safeParse({ game: String(id), teams: [String(id), String(id)], idempotencyKey: "abcdefgh" }).success).toBe(false);
  });
  it("blocks normal audit update and delete operations", async () => {
    const doc = new AuditLog({ actor: new Types.ObjectId(), action: "x", targetType: "x", targetId: "x" });
    await expect(AuditLog.updateOne({ _id: doc._id }, { $set: { action: "y" } })).rejects.toThrow("AUDIT_LOG_IMMUTABLE");
  });
  it("declares unique identity/team/match indexes", () => {
    expect(Student.schema.indexes().some(([keys, options]) => keys.identityKey === 1 && options.unique === true)).toBe(true);
    expect(Team.schema.indexes().some(([keys, options]) => keys.nameKey === 1 && options.unique === true)).toBe(true);
    expect(Match.schema.indexes().some(([keys, options]) => keys.teams === 1 && options.unique === true && options.partialFilterExpression?.status === "IN_PROGRESS")).toBe(true);
    expect(BoardGameAssignment.schema.indexes().some(([keys, options]) => keys.session === 1 && keys.student === 1 && options.unique === true)).toBe(true);
    expect(SoloParticipation.schema.indexes().some(([keys, options]) => keys.activity === 1 && keys.student === 1 && options.unique === true)).toBe(true);
  });
});
