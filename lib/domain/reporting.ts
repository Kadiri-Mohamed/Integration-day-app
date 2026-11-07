const secretKey = /password|secret|token|credential|authorization|cookie|api.?key/i;

export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKey.test(key)).map(([key, entry]) => [key, sanitizeAuditValue(entry)]));
  }
  return value;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) => {
    let text = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;
  };
  return [columns.map(cell).join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n");
}

export function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function countMatchStatuses(rows: { status: string }[]) {
  return rows.reduce((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts; }, {} as Record<string, number>);
}

export type ReportFilters = { q?: string; from?: string; to?: string; year?: string; className?: string; gender?: string; mode?: string; teamId?: string; gameId?: string };
export function filterReportRows<T extends Record<string, unknown>>(rows: T[], filters: ReportFilters) {
  const needle = filters.q?.toLocaleLowerCase();
  const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
  return rows.filter((row) => {
    if (needle && !Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase().includes(needle))) return false;
    if (filters.year && row.year !== undefined && row.year !== filters.year && !(Array.isArray(row.years) && row.years.includes(filters.year))) return false;
    if (filters.className && row.className !== undefined && row.className !== filters.className && !(Array.isArray(row.classes) && row.classes.includes(filters.className))) return false;
    if (filters.gender && row.gender !== undefined && row.gender !== filters.gender && !(Array.isArray(row.genders) && row.genders.includes(filters.gender))) return false;
    if (filters.mode && row.mode !== undefined && row.mode !== filters.mode && !(Array.isArray(row.modes) && row.modes.includes(filters.mode))) return false;
    if (filters.teamId && row.teamId !== undefined && row.teamId !== filters.teamId) return false;
    if (filters.gameId && row.gameId !== undefined && row.gameId !== filters.gameId) return false;
    const dateValue = row.date ?? row.completedAt ?? row.startedAt ?? row.createdAt ?? row.occurredAt;
    if (dateValue != null) {
      const date = new Date(String(dateValue));
      if (from && (!Number.isFinite(date.getTime()) || date < from)) return false;
      if (to && (!Number.isFinite(date.getTime()) || date > to)) return false;
    }
    return true;
  });
}
