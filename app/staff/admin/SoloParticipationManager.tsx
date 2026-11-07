"use client";
import { useCallback, useEffect, useState } from "react";
type Row = Record<string, unknown> & { _id?: string; id?: string };
const keyOf = (row: Row) => String(row._id ?? row.id ?? "");

export default function SoloParticipationManager({ activities, onError }: { activities: Row[]; onError: (value: string) => void }) {
  const [activityId, setActivityId] = useState(""); const [studentId, setStudentId] = useState(""); const [rows, setRows] = useState<Row[]>([]);
  const activity = activities.find(item => keyOf(item) === activityId);
  const load = useCallback(async () => {
    if (!activityId) { setRows([]); return; }
    const response = await fetch(`/api/admin/solo-activities/${activityId}/participations`, { cache: "no-store" }); const data = await response.json();
    if (!response.ok) { onError(data.error ?? "Could not load SOLO participation"); return; } setRows(Array.isArray(data.participations) ? data.participations : []);
  }, [activityId, onError]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function enroll() {
    if (!studentId.trim()) return onError("Enter a participant ID to enroll.");
    const response = await fetch(`/api/admin/solo-activities/${activityId}/participations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: studentId.trim() }) }); const data = await response.json();
    if (!response.ok) { onError(data.error ?? "Enrollment failed"); return; } setStudentId(""); await load();
  }
  async function updateStatus(participationId: string, status: string) {
    const response = await fetch(`/api/admin/solo-activities/${activityId}/participations`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participationId, status }) }); const data = await response.json();
    if (!response.ok) { onError(data.error ?? "Could not update participation"); return; } await load();
  }
  return <section className="mt-8 rounded-2xl border border-[#e3e8de] bg-white p-5"><h2 className="text-lg font-extrabold">SOLO participation</h2><p className="mt-1 text-xs text-[#778472]">Only active SOLO-mode participants can enroll. Team participants and team clue records are not used here.</p>{activities.length > 0 && <><label className="mt-4 grid max-w-md gap-1 text-xs font-bold">Activity<select value={activityId} onChange={e => setActivityId(e.target.value)} className="rounded-xl border p-2.5"><option value="">Select</option>{activities.map(item => <option key={keyOf(item)} value={keyOf(item)}>{String(item.name)}</option>)}</select></label>{activityId && <><p className="mt-2 text-xs text-[#778472]">{String(activity?.seatsTaken ?? 0)} / {activity?.capacity == null ? "unlimited" : String(activity.capacity)} seats · {activity?.available ? "Available" : "Unavailable"}</p><div className="mt-3 flex max-w-xl gap-2"><input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="SOLO participant ID" className="min-w-0 flex-1 rounded-xl border p-2.5 text-sm"/><button onClick={() => void enroll()} className="rounded-xl bg-[#d7f695] px-4 text-sm font-extrabold">Enroll</button></div><div className="mt-4 space-y-2">{rows.map(item => <div key={keyOf(item)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f7ef] p-3 text-sm"><span>{String((item.student as Row | undefined)?.fullName ?? "Participant")} · {String(item.status)}</span>{item.status === "REGISTERED" && <div className="flex gap-2"><button onClick={() => void updateStatus(keyOf(item), "IN_PROGRESS")} className="rounded border px-2 py-1 text-xs">Start</button><button onClick={() => void updateStatus(keyOf(item), "COMPLETED")} className="rounded border px-2 py-1 text-xs">Complete</button><button onClick={() => void updateStatus(keyOf(item), "WITHDRAWN")} className="rounded border px-2 py-1 text-xs">Withdraw</button></div>}{item.status === "IN_PROGRESS" && <button onClick={() => void updateStatus(keyOf(item), "COMPLETED")} className="rounded border px-2 py-1 text-xs">Complete</button>}</div>)}</div></>}</>}</section>;
}
