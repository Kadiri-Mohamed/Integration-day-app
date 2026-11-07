import { NextResponse } from "next/server";
import { startMatch } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/security";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const { id } = await params; const match = await startMatch(id) as { id: string; status: string }; return NextResponse.json({ id: match.id, status: match.status }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "CROSS_ORIGIN_REQUEST" ? 403 : message === "NOT_FOUND" ? 404 : ["INVALID_STATE", "TEAM_ALREADY_IN_MATCH", "GAME_UNAVAILABLE"].includes(message) ? 409 : 400 }); }
}
