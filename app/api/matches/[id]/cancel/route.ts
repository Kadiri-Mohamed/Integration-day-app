import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelMatch } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/security";
const bodySchema = z.object({ reason: z.string().trim().min(5).max(1000) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const body = bodySchema.parse(await request.json()); const { id } = await params; await cancelMatch(id, body.reason); return NextResponse.json({ id, status: "CANCELLED" }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const status = message === "FORBIDDEN" || message === "CROSS_ORIGIN_REQUEST" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "NOT_FOUND" ? 404 : message === "INVALID_STATE" ? 409 : 400; return NextResponse.json({ error: message }, { status }); }
}
