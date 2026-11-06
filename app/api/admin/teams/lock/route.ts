import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AuditLog, Match, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";

export async function POST() {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await connectDb();
    if (await Match.exists({})) return NextResponse.json({ error: "MATCHES_ALREADY_EXIST" }, { status: 409 });
    const teams = await Team.find().lean();
    if (!teams.length) return NextResponse.json({ error: "NO_TEAMS" }, { status: 422 });
    const result = await Team.updateMany({ locked: false }, { $set: { locked: true } });
    await AuditLog.create({ actor: actor.id, action: "TEAMS_LOCKED", targetType: "TeamBatch", targetId: teams.map((team) => String(team._id)).join(","), previous: { locked: false }, next: { locked: true, count: result.modifiedCount } });
    return NextResponse.json({ locked: result.modifiedCount });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 503 }); }
}
