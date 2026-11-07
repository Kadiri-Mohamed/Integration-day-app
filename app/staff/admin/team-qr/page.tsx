import Link from "next/link";
import { headers } from "next/headers";
import Image from "next/image";
import { Download, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { requireStaff } from "@/lib/permissions";
import { connectDb } from "@/lib/db";
import { Team } from "@/lib/models";
import { publicTeamUrl } from "@/lib/public-url";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export default async function TeamQrAdminPage() {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  await connectDb();
  const teams = await Team.find({ status: "ACTIVE" }).select("name slug color").sort({ name: 1 }).lean() as { name: string; slug: string; color: string }[];
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  const requestOrigin = host ? `${protocol}://${host.split(",")[0].trim()}` : undefined;
  const cards = await Promise.all(teams.map(async (team) => ({ ...team, url: publicTeamUrl(team.slug, requestOrigin), qr: await QRCode.toDataURL(publicTeamUrl(team.slug, requestOrigin), { errorCorrectionLevel: "H", margin: 2, width: 320 }) })));
  return <main className="p-5 sm:p-8"><div className="mx-auto max-w-6xl"><Link href="/staff/admin/teams" className="text-sm font-bold text-[#668c40] print:hidden">← Teams</Link><div className="mt-5 flex flex-wrap items-end justify-between gap-4 print:hidden"><div><div className="flex items-center gap-2 text-[#6b8f44]"><QrCode size={19}/><span className="text-xs font-extrabold uppercase tracking-wider">Public team cards</span></div><h1 className="mt-2 text-3xl font-black">Team QR codes</h1><p className="mt-2 text-sm text-[#73806e]">Codes encode the canonical public team page only; no login tokens or private data.</p></div><div className="flex gap-2"><a href="/api/admin/teams/qr-export" className="inline-flex items-center gap-2 rounded-full bg-[#172118] px-4 py-2.5 text-sm font-bold text-white"><Download size={15}/> Download all PNGs (ZIP)</a><PrintButton/></div></div><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">{cards.map((team)=><article key={team.slug} className="break-inside-avoid rounded-2xl border border-[#e7e9e1] bg-white p-5 print:border-black"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl font-black" style={{background:team.color}}>{team.name.charAt(0)}</span><h2 className="font-extrabold">{team.name}</h2></div><Image src={team.qr} alt={`QR for ${team.name}`} width={320} height={320} unoptimized className="mx-auto mt-4 size-48"/><p className="mt-2 break-all text-center text-xs text-[#75816c]">{team.url}</p></article>)}</div>{!cards.length&&<p className="mt-6 rounded-2xl bg-white p-6 text-sm text-[#73806e]">No active teams are available.</p>}</div></main>;
}
