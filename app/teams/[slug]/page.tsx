import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { connectDb } from "@/lib/db";
import { Clue, EventSettings, Match, Student, Team } from "@/lib/models";
import { publicTeamUrl } from "@/lib/public-url";
import { rankPublicTeams } from "@/lib/domain/leaderboard";
import TeamQrActions from "./TeamQrActions";

export const dynamic = "force-dynamic";

export default async function PublicTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await connectDb();
  const [team, settings, allTeams] = await Promise.all([
    Team.findOne({ slug: slug.toLowerCase(), status: "ACTIVE" }).select("_id name slug color members").lean(),
    EventSettings.findOne({ key: "event" }).select("eventName publicLeaderboardEnabled publicMembersEnabled lifecycleStatus").lean(),
    Team.find({ status: "ACTIVE" }).select("_id name slug").lean(),
  ]);
  if (!team) notFound();
  const [clues, memberRows, historyRows, leaderboardCounts] = await Promise.all([
    Clue.countDocuments({ team: team._id, voidedAt: null }),
    settings?.publicMembersEnabled ? Student.find({ _id: { $in: team.members ?? [] }, status: "ACTIVE" }).select("fullName").sort({ fullName: 1 }).lean() : Promise.resolve([]),
    Match.find({ teams: team._id, status: { $ne: "CANCELLED" } }).select("game teams winner status round completedAt").populate("game", "name station").populate("teams", "name slug").populate("winner", "name slug").sort({ round: 1, createdAt: 1 }).lean(),
    Clue.aggregate([{ $match: { voidedAt: null } }, { $group: { _id: "$team", clues: { $sum: 1 } } }, { $sort: { clues: -1 } }]),
  ]);
  const clueByTeam = new Map(leaderboardCounts.map((row: { _id: unknown; clues: number }) => [String(row._id), row.clues]));
  const ranked = rankPublicTeams((allTeams as { _id: unknown; name: string; slug: string }[]).map((entry) => ({ ...entry, clues: clueByTeam.get(String(entry._id)) ?? 0 })));
  const visibleHistory = settings?.publicLeaderboardEnabled === false ? [] : historyRows;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  const requestOrigin = host ? `${protocol}://${host.split(",")[0].trim()}` : undefined;
  const url = publicTeamUrl(team.slug, requestOrigin);
  const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 2, width: 480, color: { dark: "#172118", light: "#ffffff" } });
  const history = visibleHistory as { game?: { name?: string; station?: string }; teams?: { name: string; slug: string }[]; winner?: { name?: string; slug?: string } | null; status: string; round: number; completedAt?: Date | null }[];
  const nextActivity = history.find((match) => match.status === "IN_PROGRESS") ?? history.find((match) => match.status === "PENDING");
  const rank = ranked.find((entry) => String(entry._id) === String(team._id))?.rank ?? 0;

  return <main className="min-h-screen bg-[#f7f7f2] px-5 py-8 text-[#172118] sm:px-8"><div className="mx-auto max-w-5xl"><Link href="/" className="text-sm font-bold text-[#648042] print:hidden">← YouPulse event</Link><section className="mt-5 rounded-[28px] bg-white p-6 shadow-sm sm:p-9"><div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between"><div className="flex-1"><p className="text-xs font-extrabold uppercase tracking-[.15em] text-[#7e9e55]">{settings?.eventName ?? "YouPulse"} · Team profile</p><div className="mt-4 flex items-center gap-4"><span className="grid size-16 place-items-center rounded-2xl text-2xl font-black" style={{ backgroundColor: team.color }}>{team.name.charAt(0)}</span><div><h1 className="text-4xl font-black tracking-tight">{team.name}</h1><p className="mt-1 text-sm text-[#7a8576]">{settings?.lifecycleStatus === "LIVE" ? "Competition in progress" : settings?.lifecycleStatus === "COMPLETED" ? "Event completed" : "Competition progress"}</p></div></div><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">{settings?.publicLeaderboardEnabled !== false && <Stat label="Leaderboard position" value={`#${rank}`}/>}<Stat label="Earned clues" value={String(clues)}/><Stat label="Matches completed" value={`${history.filter((match) => match.status === "DONE").length}/${history.length}`}/></div><div className="mt-6 h-2 overflow-hidden rounded-full bg-[#eef0e9]"><div className="h-full rounded-full bg-[#9fc95f]" style={{ width: `${history.length ? Math.round(history.filter((match) => match.status === "DONE").length / history.length * 100) : 0}%` }}/></div>
          {settings?.publicMembersEnabled && <section className="mt-8"><h2 className="text-lg font-extrabold">Team members</h2>{memberRows.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">{(memberRows as { fullName: string }[]).map((member, index) => <li key={`${member.fullName}-${index}`} className="rounded-xl bg-[#f7f8f3] px-4 py-3 text-sm font-semibold">{member.fullName}</li>)}</ul> : <p className="mt-2 text-sm text-[#7a8576]">No active members listed.</p>}</section>}
          <section className="mt-8"><h2 className="text-lg font-extrabold">Current / next activity</h2><p className="mt-3 rounded-xl bg-[#f7f8f3] px-4 py-4 text-sm font-semibold">{nextActivity ? `${nextActivity.game?.name ?? "Game"}${nextActivity.game?.station ? ` · ${nextActivity.game.station}` : ""} · ${nextActivity.status === "IN_PROGRESS" ? "In progress" : "Up next"}` : settings?.publicLeaderboardEnabled === false ? "Activity schedule is not currently public." : "No current or upcoming activity."}</p></section><section className="mt-8"><h2 className="text-lg font-extrabold">Match history</h2><div className="mt-3 space-y-2">{history.length ? history.map((match, index) => <article key={`${match.round}-${match.game?.name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f8f3] px-4 py-3"><div><p className="text-sm font-extrabold">Round {match.round} · {match.game?.name ?? "Game"}</p><p className="mt-1 text-xs text-[#7a8576]">{match.status.replaceAll("_", " ")}{match.game?.station ? ` · ${match.game.station}` : ""}</p></div><p className="text-xs font-bold">{match.winner ? `${match.winner.name} won` : match.status === "DONE" ? "Result recorded" : "Awaiting result"}</p></article>) : <p className="rounded-xl bg-[#f7f8f3] px-4 py-5 text-sm text-[#7a8576]">{settings?.publicLeaderboardEnabled === false ? "Match history is not currently public." : "No public match history yet."}</p>}</div></section></div><aside className="rounded-2xl bg-[#f7f8f3] p-4 text-center sm:w-56"><Image src={qrDataUrl} alt={`QR code for ${team.name} public team page`} width={480} height={480} unoptimized className="mx-auto aspect-square w-full rounded-xl bg-white p-2"/><p className="mt-3 break-all text-[10px] font-semibold text-[#75816c]">{url}</p><TeamQrActions qrDataUrl={qrDataUrl} slug={team.slug}/></aside></div><p className="mt-8 text-xs text-[#889283]">Clue content stays private until the event’s authorized final reveal.</p></section></div></main>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[#f7f8f3] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-[#899282]">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>; }
