"use client";
import { useState } from "react";
export default function MatchEndForm({ matchId, teams }: { matchId: string; teams: { id: string; name: string }[] }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(form: FormData) {
    setBusy(true); setError("");
    const response = await fetch(`/api/matches/${matchId}/end`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winnerId: form.get("winnerId"), resultDetails: form.get("resultDetails") }) });
    setBusy(false);
    if (!response.ok) { const data = await response.json(); setError(data.error === "NO_CLUE_CONFIGURED" ? "Add an unused clue for this game before ending the match." : "This match changed or could not be saved. Refresh and try again."); return; }
    window.location.reload();
  }
  return <form action={submit} className="flex flex-wrap items-center gap-2"><select name="winnerId" required aria-label="Select winner" className="max-w-40 rounded-xl border border-[#e5e8df] bg-white px-3 py-2.5 text-xs font-bold"><option value="">Select winner</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><input name="resultDetails" maxLength={2000} aria-label="Approved result details" placeholder="Approved result / score (optional)" className="min-w-48 rounded-xl border px-3 py-2.5 text-xs"/><button disabled={busy} className="rounded-xl bg-[#172118] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{busy ? "Saving…" : "Approve result & end"}</button>{error && <span role="alert" className="w-full text-xs font-semibold text-red-600">{error}</span>}</form>;
}
