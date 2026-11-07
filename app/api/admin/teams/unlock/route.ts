import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Match, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { validateUnlockReason } from "@/lib/team-generation";
import { touchScheduleGuard } from "@/lib/domain/schedule-guard";

const schema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "team-unlock", 10); const { reason } = schema.parse(await request.json()); await connectDb();
    const session = await Team.db.startSession(); let unlocked = 0;
    try { await session.withTransaction(async () => {
      if (await Match.exists({}).session(session)) throw new Error("MATCHES_ALREADY_EXIST");
      const teams = await Team.find({ locked: true }).session(session); if (!teams.length) return; validateUnlockReason(true,reason);
      await touchScheduleGuard(session);
      for (const team of teams) { team.locked = false; await team.save({ session }); }
      await AuditLog.create([{ actor: actor.id, action: "TEAMS_UNLOCKED", targetType: "TeamBatch", targetId: teams.map((team) => String(team._id)).join(","), previous: { locked: true }, next: { locked: false, count: teams.length }, reason }], { session }); unlocked = teams.length;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ unlocked });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "MATCHES_ALREADY_EXIST" ? 409 : 400 }); }
}
