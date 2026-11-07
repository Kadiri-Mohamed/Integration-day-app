import { NextResponse } from "next/server";
import { z } from "zod";
import { setTeamMembers } from "@/lib/domain/team-membership";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { requireStaff } from "@/lib/permissions";

const schema = z.object({ studentIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).refine((items) => new Set(items).size === items.length) }).strict();
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "team-membership", 20);
    const input = schema.parse(await request.json()); const { id } = await params; await setTeamMembers(id, input.studentIds);
    return NextResponse.json({ updated: true });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: ["FORBIDDEN","UNAUTHENTICATED"].includes(message) ? message === "FORBIDDEN" ? 403 : 401 : message === "NOT_FOUND" ? 404 : message === "RATE_LIMITED" ? 429 : ["TEAM_LOCKED","TEAM_MEMBERSHIP_CONFLICT"].includes(message) ? 409 : 400 }); }
}
