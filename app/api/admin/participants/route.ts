import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Student } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";

const studentSchema = z.object({ fullName: z.string().trim().min(2).max(120), year: z.enum(["A1", "A2"]), className: z.string().trim().min(1).max(50), gender: z.enum(["F", "M", "X", "UNSPECIFIED"]).default("UNSPECIFIED"), mode: z.enum(["TEAM", "SOLO"]).default("TEAM") });
const importSchema = z.array(studentSchema).min(1).max(1000);
export async function GET() {
  try { await requireStaff(["SUPER_ADMIN", "ADMIN"]); await connectDb(); const students = await Student.find().select("fullName year className gender mode team").sort({ fullName: 1 }).lean(); return NextResponse.json({ students }); }
  catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 503 }); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); const rows = importSchema.parse(await request.json()); await connectDb();
    const keys = rows.map((row) => `${row.fullName.toLocaleLowerCase()}|${row.className.toLocaleLowerCase()}`);
    if (new Set(keys).size !== keys.length) return NextResponse.json({ error: "DUPLICATES_IN_IMPORT" }, { status: 409 });
    const existing = await Student.find({ $or: rows.map((row) => ({ fullName: new RegExp(`^${row.fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), className: new RegExp(`^${row.className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) }).select("fullName className").lean();
    if (existing.length) return NextResponse.json({ error: "DUPLICATES_ALREADY_REGISTERED", duplicates: existing }, { status: 409 });
    const created = await Student.insertMany(rows, { ordered: true });
    await AuditLog.create({ actor: actor.id, action: "PARTICIPANTS_IMPORTED", targetType: "StudentBatch", targetId: created.map((student) => student.id).join(","), next: { count: created.length } });
    return NextResponse.json({ imported: created.length }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
