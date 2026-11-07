import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { normalizeIdentityKey } from "@/lib/domain/identity.mjs";
import { participantInputSchema } from "@/lib/domain/validation";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const importSchema = z.array(z.unknown()).min(1).max(1000);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function csvCell(value: unknown) { const text = String(value ?? ""); return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; }

export async function GET(request: NextRequest) {
  try {
    await requireStaff(["SUPER_ADMIN", "ADMIN"]); await connectDb();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 25) || 25));
    const filter: Record<string, unknown> = {};
    const q = params.get("q")?.trim(); if (q) filter.fullName = { $regex: escapeRegex(q), $options: "i" };
    for (const key of ["year", "className", "gender", "mode", "status"] as const) { const value = params.get(key); if (value && value !== "ALL") filter[key] = value; }
    if (params.get("team")) filter.team = params.get("team") === "UNASSIGNED" ? null : params.get("team");
    if (params.get("format") === "csv") {
      const students = await Student.find(filter).select("fullName year className gender mode team status").populate("team", "name").sort({ fullName: 1 }).limit(10000).lean();
      const lines = ["fullName,year,className,gender,mode,status,team", ...students.map((s) => [s.fullName,s.year,s.className,s.gender,s.mode,s.status,typeof s.team === "object" && s.team ? (s.team as {name?:string}).name : ""].map(csvCell).join(","))];
      return new Response(lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=participants.csv", "Cache-Control": "no-store" } });
    }
    const [students, total, classes, teams] = await Promise.all([Student.find(filter).select("fullName year className gender mode team status createdAt").populate("team", "name").sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), Student.countDocuments(filter), Student.distinct("className"), Team.find().select("name").sort({name:1}).lean()]);
    return NextResponse.json({ students, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, teams, classes: classes.sort() });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 503 }); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "participant-write", 20);
    const body: unknown = await request.json(); await connectDb();
    if (!Array.isArray(body) && body && typeof body === "object" && !("rows" in body)) {
      const parsed = participantInputSchema.parse(body);
      const duplicate = await Student.exists({ identityKey: parsed.identityKey }); if (duplicate) return NextResponse.json({ error: "DUPLICATE_PARTICIPANT", identityKey: parsed.identityKey }, { status: 409 });
      const [student] = await Student.create([{ ...parsed, registration: { source: "MANUAL", registeredBy: actor.id } }]);
      await AuditLog.create({ actor: actor.id, action: "PARTICIPANT_CREATED", targetType: "Student", targetId: student.id, next: { fullName: student.fullName, year: student.year, className: student.className, mode: student.mode } });
      return NextResponse.json({ id: student.id, participant: student }, { status: 201 });
    }
    const importRequest = Array.isArray(body) ? { rows: body, dryRun: false } : z.object({ rows: importSchema, dryRun: z.boolean().default(true) }).parse(body);
    const rows = importSchema.parse(importRequest.rows);
    const parsedRows = rows.map((row, index) => { const result = participantInputSchema.safeParse(row); return result.success ? { row: index + 2, value: result.data } : { row: index + 2, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`) }; });
    const normalized = await Student.find().select("identityKey fullName year className").lean();
    const known = new Set(normalized.map((row) => row.identityKey || normalizeIdentityKey(row)));
    const seen = new Set<string>(); const reported = parsedRows.map((result) => {
      if (!result.value) return { row: result.row, status: "INVALID", errors: result.errors };
      const key = result.value.identityKey;
      if (seen.has(key)) return { row: result.row, status: "DUPLICATE", errors: ["Duplicate identity in this file"] };
      seen.add(key);
      if (known.has(key)) return { row: result.row, status: "DUPLICATE", errors: ["Participant already exists"] };
      return { row: result.row, status: "VALID", value: result.value };
    });
    const validRows = reported.filter((row) => row.status === "VALID");
    const summary = { total: rows.length, valid: validRows.length, invalid: reported.filter((row) => row.status === "INVALID").length, duplicates: reported.filter((row) => row.status === "DUPLICATE").length, accepted: 0, rejected: reported.length - validRows.length };
    if (importRequest.dryRun) return NextResponse.json({ summary, rows: reported.map(({ row, status, errors }) => ({ row, status, errors })) });
    if (summary.rejected) return NextResponse.json({ error: "IMPORT_HAS_REJECTED_ROWS", summary, rows: reported.map(({ row, status, errors }) => ({ row, status, errors })) }, { status: 422 });
    const session = await Student.db.startSession(); let imported = 0;
    try { await session.withTransaction(async () => {
      const docs = validRows.map((row) => ({ ...row.value!, registration: { source: "CSV", registeredBy: actor.id } }));
      const created = await Student.insertMany(docs, { ordered: true, session }); imported = created.length;
      await AuditLog.create([{ actor: actor.id, action: "PARTICIPANTS_IMPORTED", targetType: "StudentBatch", targetId: created.map((student) => student.id).join(","), next: { count: imported } }], { session });
    }); } finally { await session.endSession(); }
    return NextResponse.json({ imported, summary: { ...summary, accepted: imported, rejected: 0 }, rows: reported.map(({ row, status }) => ({ row, status })) }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const duplicate = error && typeof error === "object" && "code" in error && error.code === 11000; return NextResponse.json({ error: duplicate ? "DUPLICATE_PARTICIPANT" : message }, { status: ["FORBIDDEN","UNAUTHENTICATED"].includes(message) ? message === "FORBIDDEN" ? 403 : 401 : message === "RATE_LIMITED" ? 429 : duplicate ? 409 : 400 }); }
}
