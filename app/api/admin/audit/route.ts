import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSensitiveRateLimit } from "@/lib/security";
import { AuditLog, StaffUser } from "@/lib/models";
import { escapeRegex, sanitizeAuditValue, toCsv } from "@/lib/domain/reporting";

export const dynamic = "force-dynamic";
const filterSchema = z.object({ actor: z.string().trim().max(120).optional(), action: z.string().trim().max(120).optional(), entityType: z.string().trim().max(120).optional(), targetId: z.string().trim().max(120).optional(), from: z.string().optional(), to: z.string().optional(), format: z.enum(["json", "csv"]).default("json") });

export async function GET(request: Request) {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
    const filters = filterSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (filters.format === "csv") await assertSensitiveRateLimit(actor.id, "audit-csv-export", 20);
    await connectDb();
    const query: Record<string, unknown> = {};
    if (filters.action) query.action = new RegExp(escapeRegex(filters.action), "i");
    if (filters.entityType) query.targetType = new RegExp(escapeRegex(filters.entityType), "i");
    if (filters.targetId) query.targetId = new RegExp(escapeRegex(filters.targetId), "i");
    if (filters.actor) {
      if (Types.ObjectId.isValid(filters.actor)) query.actor = new Types.ObjectId(filters.actor);
      else { const staff = await StaffUser.find({ $or: [{ name: new RegExp(escapeRegex(filters.actor), "i") }, { email: new RegExp(escapeRegex(filters.actor), "i") }] }).distinct("_id"); query.actor = { $in: staff }; }
    }
    if (filters.from || filters.to) {
      const occurredAt: Record<string, Date> = {};
      if (filters.from) { const date = new Date(filters.from); if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE_FILTER"); date.setUTCHours(0, 0, 0, 0); occurredAt.$gte = date; }
      if (filters.to) { const date = new Date(filters.to); if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE_FILTER"); date.setUTCHours(23, 59, 59, 999); occurredAt.$lte = date; }
      query.occurredAt = occurredAt;
    }
    const logs = await AuditLog.find(query).populate("actor", "name role").sort({ occurredAt: -1 }).limit(10000).lean();
    const rows = logs.map((entry: { _id: unknown; actor?: { name?: string; role?: string }; action: string; targetType: string; targetId: string; previous?: unknown; next?: unknown; reason?: string; occurredAt: Date }) => ({ id: String(entry._id), actor: entry.actor?.name ?? "Former staff account", role: entry.actor?.role ?? "", action: entry.action, entityType: entry.targetType, targetId: entry.targetId, previous: sanitizeAuditValue(entry.previous) ?? null, next: sanitizeAuditValue(entry.next) ?? null, reason: entry.reason ?? "", occurredAt: entry.occurredAt }));
    if (filters.format === "csv") {
      const csv = rows.map(({ id, actor: name, role, action, entityType, targetId, previous, next, reason, occurredAt }) => ({ id, actor: name, role, action, entityType, targetId, previous: JSON.stringify(previous), next: JSON.stringify(next), reason, occurredAt }));
      return new Response(toCsv(csv), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="youpulse-audit-log.csv"', "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ count: rows.length, items: rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : message === "RATE_LIMITED" ? 429 : message.startsWith("Invalid input") || message === "INVALID_DATE_FILTER" ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? "AUDIT_UNAVAILABLE" : message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
