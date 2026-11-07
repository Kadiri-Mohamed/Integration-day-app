import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDb();
    await mongoose.connection.db?.admin().ping();
    return NextResponse.json({ status: "ok", database: "connected", checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
