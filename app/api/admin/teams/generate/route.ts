import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, BoardGameAssignment, Match, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { validateTeamDraft } from "@/lib/team-generation";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";

const schema = z.object({ seed: z.string().min(1).max(100), teams: z.array(z.object({ name: z.string().trim().min(2).max(100), color: z.string().regex(/^#[0-9a-f]{6}$/i), studentIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100) }).strict()).min(1).max(100), policyApproval: z.string().trim().min(10).max(500).optional() }).strict();
const makeSlug = (value: string) => value.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toLowerCase();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "team-generation", 5);
    const input = schema.parse(await request.json()); await connectDb(); const session = await Team.db.startSession(); let applied = 0;
    try { await session.withTransaction(async () => {
      if (await Match.exists({}).session(session) || await BoardGameAssignment.exists({}).session(session)) throw new Error("TEAMS_IN_USE");
      const current = await Team.find().session(session); if (current.some((team) => team.locked)) throw new Error("LOCKED_TEAMS_EXIST");
      const students = await Student.find({ mode: "TEAM", status: "ACTIVE" }).session(session);
      validateTeamDraft(input.teams, students.map((student) => String(student._id)), false, input.policyApproval);
      const previous = current.map((team) => ({ id: String(team._id), name: team.name, members: team.members.map(String) }));
      await touchScheduleGuard(session);
      await Student.updateMany({ mode: "TEAM" }, { $set: { team: null } }, { session });
      await Team.deleteMany({}, { session });
      const slugs = input.teams.map((team) => makeSlug(team.name)); if (new Set(slugs).size !== slugs.length) throw new Error("DUPLICATE_TEAM_NAMES");
      const docs = input.teams.map((team, index) => ({ name: team.name, nameKey: team.name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"), slug: slugs[index], color: team.color, members: team.studentIds }));
      const created = await Team.insertMany(docs, { session });
      for (const team of created) await Student.updateMany({ _id: { $in: team.members } }, { $set: { team: team._id } }, { session });
      const next = created.map((team) => ({ id: String(team._id), name: team.name, color: team.color, members: team.members.map(String), size: team.members.length }));
      await AuditLog.create([{ actor: actor.id, action: "TEAMS_GENERATED", targetType: "TeamBatch", targetId: created.map((team) => team.id).join(","), previous: { teams: previous }, next: { teams: next, seed: input.seed, policyApproval: input.policyApproval ?? null } }], { session }); applied = created.length;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ applied });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const status = message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : ["LOCKED_TEAMS_EXIST","TEAMS_IN_USE"].includes(message) ? 409 : message === "TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE" ? 422 : ["PARTICIPANT_SET_MISMATCH","DUPLICATE_PARTICIPANTS","TEAM_SIZE_POLICY_APPROVAL_REQUIRED","DUPLICATE_TEAM_NAMES"].includes(message) ? 400 : 400; return NextResponse.json({ error: message }, { status }); }
}
