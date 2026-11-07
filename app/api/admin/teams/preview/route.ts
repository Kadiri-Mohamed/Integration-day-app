import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { generateBalancedTeams, teamBalanceReport } from "@/lib/team-generation";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const schema = z.object({ seed: z.string().min(1).max(100).default("youpulse"), prefix: z.string().trim().min(1).max(40).default("Team"), teamSizes: z.array(z.number().int().min(1).max(100)).max(100).optional() }).strict();
const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "team-preview", 20);
    const input = schema.parse(await request.json()); await connectDb();
    const students = await Student.find({ mode: "TEAM", status: "ACTIVE" }).select("fullName year className gender mode").lean();
    const existing = await Team.find().select("locked").lean();
    if (existing.some((team) => team.locked)) throw new Error("LOCKED_TEAMS_EXIST");
    const groups = generateBalancedTeams(students as Parameters<typeof generateBalancedTeams>[0], 6, 1200, input.seed, input.teamSizes);
    const reports = teamBalanceReport(groups);
    return NextResponse.json({ seed: input.seed, totalParticipants: students.length, unassigned: [], teamSizes: groups.map((g) => g.length), policyApprovalRequired: groups.some((g) => g.length !== 6), teams: groups.map((members, i) => ({ name: `${input.prefix} ${String(i + 1).padStart(2, "0")}`, color: colors[i % colors.length], members: members.map((member) => ({ ...member, _id: String(member._id) })), ...reports[i] })) });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "LOCKED_TEAMS_EXIST" ? 409 : message === "TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE" ? 422 : 400 }); }
}
