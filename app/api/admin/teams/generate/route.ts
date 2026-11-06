import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Match, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { generateBalancedTeams } from "@/lib/team-generation";

const inputSchema = z.object({ prefix: z.string().trim().min(1).max(40).default("Team"), targetSize: z.literal(6).default(6) });
export async function POST(request: Request) {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); const input = inputSchema.parse(await request.json()); await connectDb();
    const session = await Team.db.startSession(); let generated: { name: string; members: string[] }[] = [];
    try {
      await session.withTransaction(async () => {
        const students = await Student.find({ mode: "TEAM" }).session(session).lean();
        const groups = generateBalancedTeams(students as Parameters<typeof generateBalancedTeams>[0], input.targetSize);
        const existingTeams = await Team.find().session(session).lean();
        if (existingTeams.some((team: { locked?: boolean }) => team.locked)) throw new Error("LOCKED_TEAMS_EXIST");
        if (await Match.exists({}).session(session)) throw new Error("MATCHES_ALREADY_EXIST");
        await Student.updateMany({ mode: "TEAM" }, { $set: { team: null } }, { session });
        await Team.deleteMany({}, { session });
        const documents = groups.map((members, index) => ({ name: `${input.prefix} ${String(index + 1).padStart(2, "0")}`, slug: `${input.prefix}-${index + 1}`.toLowerCase().replace(/[^a-z0-9-]/g, "-") }));
        const created = await Team.insertMany(documents, { session });
        for (const [index, members] of groups.entries()) await Student.updateMany({ _id: { $in: members.map((student) => student._id) } }, { $set: { team: created[index]._id } }, { session });
        generated = created.map((team, index) => ({ name: team.name, members: groups[index].map((student) => student.fullName) }));
        await AuditLog.create([{ actor: actor.id, action: "TEAMS_GENERATED", targetType: "TeamBatch", targetId: created.map((team) => team.id).join(","), next: { count: created.length, targetSize: input.targetSize } }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ teams: generated }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = message === "FORBIDDEN" ? 403 : ["LOCKED_TEAMS_EXIST", "MATCHES_ALREADY_EXIST"].includes(message) ? 409 : message === "TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE" ? 422 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
