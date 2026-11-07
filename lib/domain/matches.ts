import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, Game, Match, Rotation, RotationSlot, Student, Team, StaffUser, GameAssignment } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { matchCreateSchema } from "./validation";
import { assertSensitiveRateLimit } from "@/lib/security";
import { assertCompetitiveMatchGame, assertMatchCreationAllowed } from "./match-policy";

export async function createMatch(input: unknown) {
  const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  await assertSensitiveRateLimit(actor.id, "match-create", 30);
  const parsed = matchCreateSchema.parse(input);
  await connectDb(); const session = await Match.db.startSession();
  try {
    let result: unknown;
    await session.withTransaction(async () => {
      const prior = await Match.findOne({ idempotencyKey: parsed.idempotencyKey }).session(session);
      if (prior) {
        if (String(prior.game) !== parsed.game || prior.teams.map(String).sort().join(",") !== [...parsed.teams].sort().join(",")) throw new Error("IDEMPOTENCY_KEY_REUSED");
        result = prior; return;
      }
      const game = await Game.findById(parsed.game).session(session);
      if (!game) throw new Error("GAME_UNAVAILABLE");
      assertMatchCreationAllowed(actor.role,game.active,game.frozen,parsed.frozenOverrideReason);
      assertCompetitiveMatchGame(game.category, game.supportedModes);
      if (parsed.teams.length !== game.teamsPerMatch) throw new Error("INVALID_TEAM_COUNT");
      const teams = await Team.find({ _id: { $in: parsed.teams }, status: "ACTIVE", locked: true }).session(session);
      if (teams.length !== parsed.teams.length || teams.some((team) => team.members.length === 0)) throw new Error("INVALID_MATCH_TEAMS");
      const memberships = await Promise.all(teams.map(async (team) => Student.countDocuments({ _id: { $in: team.members }, team: team._id, mode: "TEAM", status: "ACTIVE" }).session(session)));
      if (memberships.some((count, index) => count !== teams[index].members.length)) throw new Error("INVALID_MATCH_TEAMS");
      if (parsed.assignedGameMaster) {
        const master = await StaffUser.findOne({ _id: parsed.assignedGameMaster, role: "GAME_MASTER", active: true }).session(session);
        const assignment = await GameAssignment.exists({ game: game._id, staffUser: parsed.assignedGameMaster, active: true }).session(session);
        if (!master || !assignment) throw new Error("INVALID_GAME_MASTER");
      }
      if (parsed.rotation) {
        const rotation = await Rotation.findById(parsed.rotation).session(session);
        if (!rotation || !["PUBLISHED", "ACTIVE"].includes(rotation.status)) throw new Error("ROTATION_UNAVAILABLE");
        if (parsed.rotationSlot) {
          const slot = await RotationSlot.findOne({ _id: parsed.rotationSlot, rotation: rotation._id, kind: "GAME", status: { $nin: ["CANCELLED", "COMPLETED"] } }).session(session);
          if (!slot) throw new Error("INVALID_ROTATION_SLOT");
        }
      } else if (parsed.rotationSlot) throw new Error("INVALID_ROTATION_SLOT");
      const [match] = await Match.create([{ game: game._id, rotation: parsed.rotation, rotationSlot: parsed.rotationSlot, teams: parsed.teams.map((id) => new Types.ObjectId(id)), status: "PENDING", assignedGameMaster: parsed.assignedGameMaster, idempotencyKey: parsed.idempotencyKey }], { session });
      const [audit] = await AuditLog.create([{ actor: actor.id, action: "MATCH_CREATED", targetType: "Match", targetId: match.id, next: { game: game.id, teams: parsed.teams, rotation: parsed.rotation, rotationSlot: parsed.rotationSlot, ...(game.frozen ? { frozenOverrideReason: parsed.frozenOverrideReason } : {}) } }], { session });
      match.auditRefs.push(audit._id); await match.save({ session }); result = match;
    });
    return result;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      const prior = await Match.findOne({ idempotencyKey: parsed.idempotencyKey });
      if (prior && String(prior.game) === parsed.game && prior.teams.map(String).sort().join(",") === [...parsed.teams].sort().join(",")) return prior;
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    throw error;
  } finally { await session.endSession(); }
}
