import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";

export async function setTeamMembers(teamId: string, studentIds: string[]) {
  const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  if (!Types.ObjectId.isValid(teamId) || studentIds.some((id) => !Types.ObjectId.isValid(id)) || new Set(studentIds).size !== studentIds.length) throw new Error("INVALID_INPUT");
  await connectDb(); const session = await Team.db.startSession();
  try {
    let result: unknown;
    await session.withTransaction(async () => {
      const team = await Team.findById(teamId).session(session);
      if (!team) throw new Error("NOT_FOUND");
      if (team.locked) throw new Error("TEAM_LOCKED");
      const members = await Student.find({ _id: { $in: studentIds } }).session(session);
      if (members.length !== studentIds.length || members.some((s) => s.mode !== "TEAM" || s.status !== "ACTIVE")) throw new Error("INVALID_TEAM_MEMBER");
      const other = await Team.findOne({ _id: { $ne: team._id }, members: { $in: studentIds.map((id) => new Types.ObjectId(id)) } }).session(session);
      if (other) throw new Error("TEAM_MEMBERSHIP_CONFLICT");
      const previous = team.members.map(String);
      await Student.updateMany({ _id: { $in: previous }, team: team._id }, { $set: { team: null } }, { session });
      await Student.updateMany({ _id: { $in: studentIds } }, { $set: { team: team._id } }, { session });
      team.members = studentIds.map((id) => new Types.ObjectId(id)); await team.save({ session });
      const [audit] = await AuditLog.create([{ actor: actor.id, action: "TEAM_MEMBERS_MODIFIED", targetType: "Team", targetId: teamId, previous: { members: previous }, next: { members: studentIds } }], { session });
      result = team; void audit;
    });
    return result;
  } finally { await session.endSession(); }
}
