import { NextResponse } from "next/server";
import { startMatch } from "@/lib/permissions";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; const match = await startMatch(id); return NextResponse.json({ id: match.id, status: match.status }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : message === "INVALID_STATE" ? 409 : 400 }); }
}
