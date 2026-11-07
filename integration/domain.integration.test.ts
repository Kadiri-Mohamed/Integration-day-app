import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ClueTemplate, Game, Student } from "../lib/models";

const uri = process.env.TEST_MONGODB_URI;
const integration = uri ? describe : describe.skip;

integration("MongoDB replica-set integration", () => {
  beforeAll(async () => {
    const databaseName = new URL(uri!).pathname.replace(/^\//, "").split("?")[0];
    if (!/test/i.test(databaseName)) throw new Error("TEST_MONGODB_URI must name a disposable database containing 'test'.");
    await mongoose.connect(uri!, { autoIndex: false, bufferCommands: false, serverSelectionTimeoutMS: 10_000 });
    await Student.createIndexes();
    await ClueTemplate.createIndexes();
  });
  beforeEach(async () => {
    await Promise.all([Student.deleteMany({}), ClueTemplate.deleteMany({}), Game.deleteMany({})]);
  });
  afterAll(async () => { await mongoose.disconnect(); });

  it("enforces normalized participant identity with a unique database index", async () => {
    await Student.create({ fullName: "Amina Ben", identityKey: '["amina ben","A1","g1"]', year: "A1", className: "G1", mode: "TEAM" });
    await expect(Student.create({ fullName: "AMINA   BEN", identityKey: '["amina ben","A1","g1"]', year: "A1", className: "G1", mode: "TEAM" })).rejects.toMatchObject({ code: 11000 });
  });

  it("rolls back all writes when a transaction fails", async () => {
    const session = await mongoose.startSession();
    try {
      await expect(session.withTransaction(async () => {
        await Student.create([{ fullName: "Rollback User", identityKey: "rollback", year: "A1", className: "G1", mode: "TEAM" }], { session });
        throw new Error("simulated failure");
      })).rejects.toThrow("simulated failure");
      expect(await Student.countDocuments({ identityKey: "rollback" })).toBe(0);
    } finally { await session.endSession(); }
  });

  it("reserves the lowest priority unused clue template exactly once", async () => {
    const [game] = await Game.create([{ name: "Integration game", category: "COMPETITIVE", supportedModes: ["TEAM"], teamsPerMatch: 2 }]);
    await ClueTemplate.create([
      { game: game._id, content: "Second", priority: 2, active: true, used: false, reservedFor: null },
      { game: game._id, content: "First", priority: 1, active: true, used: false, reservedFor: null },
    ]);
    const selected = await ClueTemplate.findOneAndUpdate({ game: game._id, active: true, used: false, reservedFor: null }, { $set: { used: true } }, { new: true, sort: { priority: 1, createdAt: 1, _id: 1 } });
    expect(selected?.content).toBe("First");
    expect(await ClueTemplate.countDocuments({ game: game._id, used: true })).toBe(1);
  });
});
