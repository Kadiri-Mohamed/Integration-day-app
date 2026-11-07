import { NextResponse } from "next/server";
import { endMatch } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/security";
import { matchResultSchema } from "@/lib/domain/validation";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const body = matchResultSchema.parse(await request.json()); const { id } = await params; await endMatch(id, body.winnerId, body.resultDetails); return NextResponse.json({ ok: true, status: "DONE" }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const status = message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "CROSS_ORIGIN_REQUEST" ? 403 : message === "NOT_FOUND" ? 404 : ["INVALID_STATE", "GAME_UNAVAILABLE", "NO_CLUE_CONFIGURED", "RESULT_ALREADY_RECORDED"].includes(message) ? 409 : 400; return NextResponse.json({ error: message }, { status }); }
}
