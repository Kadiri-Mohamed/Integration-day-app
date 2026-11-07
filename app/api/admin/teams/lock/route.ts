import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Match, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";

const requestSchema = z.object({ policyApproval: z.string().trim().min(10).max(500).optional() }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "team-lock", 10); const input = requestSchema.parse(await request.json()); await connectDb();
    const session = await Team.db.startSession(); let locked = 0;
    try { await session.withTransaction(async () => {
      if (await Match.exists({}).session(session)) throw new Error("MATCHES_ALREADY_EXIST");
      const teams = await Team.find().session(session); if (!teams.length) throw new Error("NO_TEAMS");
      const teamIds = teams.flatMap((team) => team.members.map(String));
      if (new Set(teamIds).size !== teamIds.length) throw new Error("DUPLICATE_PARTICIPANTS");
      const activeTeamStudents = await Student.find({ mode: "TEAM", status: "ACTIVE" }).session(session);
      if (teamIds.length !== activeTeamStudents.length || activeTeamStudents.some((student) => !teamIds.includes(String(student._id)) || !teams.some((team) => String(team._id) === String(student.team)))) throw new Error("TEAM_MEMBERSHIP_INCONSISTENT");
      const nonStandard = teams.some((team) => team.members.length !== 6);
      if (nonStandard && !input.policyApproval) throw new Error("TEAM_SIZE_POLICY_APPROVAL_REQUIRED");
      if (teams.every((team) => team.locked)) { locked = 0; return; }
      await touchScheduleGuard(session);
      for (const team of teams) { team.locked = true; await team.save({ session }); }
      const [audit] = await AuditLog.create([{ actor: actor.id, action: "TEAMS_LOCKED", targetType: "TeamBatch", targetId: teams.map((team) => String(team._id)).join(","), previous: { locked: false }, next: { locked: true, count: teams.length, policyApproval: input.policyApproval ?? null } }], { session }); void audit;
      locked = teams.length;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ locked });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const status = message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : ["MATCHES_ALREADY_EXIST","DUPLICATE_PARTICIPANTS","TEAM_MEMBERSHIP_INCONSISTENT","TEAM_SIZE_POLICY_APPROVAL_REQUIRED"].includes(message) ? 409 : message === "NO_TEAMS" ? 400 : 503; return NextResponse.json({ error: message }, { status }); }
}
