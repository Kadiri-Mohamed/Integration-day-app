import { describe, expect, it } from "vitest";
import { countMatchStatuses, escapeRegex, filterReportRows, sanitizeAuditValue, toCsv } from "./reporting";

describe("admin reporting helpers", () => {
  it("counts every persisted match state without dropping cancelled rows", () => {
    expect(countMatchStatuses([{ status: "PENDING" }, { status: "DONE" }, { status: "DONE" }, { status: "CANCELLED" }])).toEqual({ PENDING: 1, DONE: 2, CANCELLED: 1 });
  });

  it("removes secret-shaped keys recursively from audit values", () => {
    expect(sanitizeAuditValue({ role: "ADMIN", passwordHash: "hidden", nested: { apiKey: "hidden", active: true } })).toEqual({ role: "ADMIN", nested: { active: true } });
  });

  it("quotes CSV cells and prevents spreadsheet formula execution", () => {
    expect(toCsv([{ name: '=HYPERLINK("https://bad")', note: "a,b" }])).toBe('"name","note"\r\n"\'=HYPERLINK(""https://bad"")","a,b"');
  });

  it("escapes user text before using it as a regular expression", () => {
    expect(new RegExp(escapeRegex("admin.+@site"), "i").test("admin.+@site")).toBe(true);
    expect(new RegExp(escapeRegex("admin.+@site"), "i").test("adminZZ@site")).toBe(false);
  });

  it("uses the same filtered rows as the CSV export", () => {
    const rows = [{ fullName: "Amina", year: "A1", mode: "TEAM", date: "2026-10-01T08:00:00.000Z" }, { fullName: "Youssef", year: "A2", mode: "SOLO", date: "2026-10-04T08:00:00.000Z" }];
    const filters = { q: "Amina", year: "A1", from: "2026-10-01", to: "2026-10-02" };
    const displayed = filterReportRows(rows, filters);
    const exported = toCsv(filterReportRows(rows, filters));
    expect(displayed).toHaveLength(1);
    expect(exported).toContain('"Amina"');
    expect(exported).not.toContain('"Youssef"');
  });
});
