"use client";
import { useState } from "react";
import useSWR from "swr";
import { FileUp, LockKeyhole, RefreshCw, Users } from "lucide-react";

type Student = { _id: string; fullName: string; year: string; className: string; gender: string; mode: string; team?: string };
function parseCsv(source: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"' && source[index + 1] === '"' && quoted) { value += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && source[index + 1] === "\n") index++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (quoted || rows.length < 2) throw new Error("CSV must include a header and at least one student row.");
  const headers = rows.shift()!.map((header) => header.toLowerCase().replace(/[\s_-]/g, "").replace(/^classname$/, "class"));
  const required = ["fullname", "year", "class", "gender", "mode"];
  if (!required.every((header) => headers.includes(header))) throw new Error("Required CSV columns: fullName, year, class, gender, mode.");
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

export default function ParticipantTools() {
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const { data, mutate: refresh } = useSWR<{ students: Student[] }>("/api/admin/participants", (url: string) => fetch(url).then((response) => response.json()));
  const students = data?.students ?? [];
  async function readFile(file?: File) { if (!file) return; setMessage(""); try { setPreview(parseCsv(await file.text())); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read CSV"); setPreview([]); } }
  async function importStudents() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/participants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preview.map((row) => ({ fullName: row.fullname, year: row.year.toUpperCase(), className: row.class, gender: (row.gender || "UNSPECIFIED").toUpperCase(), mode: (row.mode || "TEAM").toUpperCase() }))) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(result.error === "DUPLICATES_IN_IMPORT" ? "The CSV contains duplicate students." : result.error === "DUPLICATES_ALREADY_REGISTERED" ? "Some students are already registered." : result.error ?? "Import failed."); return; }
    setMessage(`Imported ${result.imported} students.`); setPreview([]); await refresh();
  }
  async function generate() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/teams/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix: "Team", targetSize: 6 }) });
    const result = await response.json(); setBusy(false);
    setMessage(response.ok ? `Generated ${result.teams.length} balanced teams of six.` : result.error === "TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE" ? "The number of TEAM participants must divide into groups of six. Configure the 5/7-player policy before continuing." : result.error === "LOCKED_TEAMS_EXIST" ? "Unlock or revise team policy before regenerating." : result.error === "MATCHES_ALREADY_EXIST" ? "Teams cannot be regenerated after match assignments exist." : result.error ?? "Generation failed."); await refresh();
  }
  async function lockTeams() {
    setBusy(true); const response = await fetch("/api/admin/teams/lock", { method: "POST" }); const result = await response.json(); setBusy(false);
    setMessage(response.ok ? `Locked ${result.locked} teams.` : result.error === "MATCHES_ALREADY_EXIST" ? "Teams cannot be locked after matches have been created." : result.error === "NO_TEAMS" ? "Generate teams first." : result.error ?? "Lock failed."); await refresh();
  }
  const teamCount = students.filter((student) => student.mode === "TEAM").length;
  return <div className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-[24px] border border-[#e5e8df] bg-white p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf5e3] text-[#628840]"><FileUp size={18}/></span><div><h2 className="font-extrabold">Import students from CSV</h2><p className="mt-1 text-xs text-[#84907e]">Columns: fullName, year, class, gender, mode</p></div></div><label className="mt-5 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#cfd8c7] bg-[#fafbf8] px-4 py-7 text-center hover:bg-[#f4f8ed]"><FileUp size={20} className="text-[#7ba14d]"/><span className="mt-2 text-xs font-bold">Choose a CSV file</span><span className="mt-1 text-[10px] text-[#91998c]">A1/A2 · F/M/X/UNSPECIFIED · TEAM/SOLO</span><input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])}/></label>{preview.length > 0 && <><div className="mt-4 max-h-52 overflow-auto rounded-xl border border-[#edf0e9]"><table className="w-full text-left text-xs"><thead className="bg-[#f5f7f1] text-[10px] uppercase text-[#879182]"><tr><th className="p-2.5">Name</th><th className="p-2.5">Year</th><th className="p-2.5">Class</th><th className="p-2.5">Mode</th></tr></thead><tbody>{preview.slice(0, 20).map((row, index) => <tr key={index} className="border-t border-[#f0f1ed]"><td className="p-2.5 font-semibold">{row.fullname}</td><td className="p-2.5">{row.year}</td><td className="p-2.5">{row.class}</td><td className="p-2.5">{row.mode || "TEAM"}</td></tr>)}</tbody></table></div><p className="mt-2 text-[10px] text-[#879182]">Previewing {Math.min(20, preview.length)} of {preview.length} rows</p><button disabled={busy} onClick={() => void importStudents()} className="mt-3 rounded-xl bg-[#172118] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Validate and import {preview.length} students</button></>}</section>
    <section className="rounded-[24px] border border-[#e5e8df] bg-white p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf5e3] text-[#628840]"><Users size={18}/></span><div><h2 className="font-extrabold">Team generation</h2><p className="mt-1 text-xs text-[#84907e]">{teamCount} registered TEAM participants · target size 6</p></div></div><p className="mt-5 rounded-xl bg-[#f5f7f1] p-3 text-xs leading-5 text-[#788373]">The organization has not approved 5 or 7 player teams. Generation currently requires a multiple of six and never moves SOLO participants into teams.</p><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || teamCount === 0} onClick={() => void generate()} className="flex items-center gap-2 rounded-xl bg-[#172118] px-4 py-3 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={14}/> Generate balanced teams</button><button disabled={busy || students.length === 0} onClick={() => void lockTeams()} className="flex items-center gap-2 rounded-xl border border-[#dfe3d8] bg-white px-4 py-3 text-xs font-bold disabled:opacity-50"><LockKeyhole size={14}/> Lock teams</button></div><div className="mt-5 space-y-2">{students.slice(0, 8).map((student) => <div key={student._id} className="flex items-center justify-between border-t border-[#f0f1ed] pt-2.5 text-xs"><span className="font-bold">{student.fullName}</span><span className="text-[#879182]">{student.year} · {student.className} · {student.mode}</span></div>)}{students.length > 8 && <p className="pt-1 text-[10px] text-[#879182]">and {students.length - 8} more participants</p>}</div></section>
    {message && <p role="status" className="lg:col-span-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-[#61714f]">{message}</p>}</div>;
}
