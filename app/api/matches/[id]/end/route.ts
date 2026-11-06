import { NextResponse } from "next/server";
import { z } from "zod";
import { endMatch } from "@/lib/permissions";
const bodySchema = z.object({ winnerId: z.string().min(1) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const body = bodySchema.parse(await request.json()); const { id } = await params; await endMatch(id, body.winnerId); return NextResponse.json({ ok: true, status: "DONE" }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const status = message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : message === "INVALID_STATE" ? 409 : 400; return NextResponse.json({ error: message }, { status }); }
}
