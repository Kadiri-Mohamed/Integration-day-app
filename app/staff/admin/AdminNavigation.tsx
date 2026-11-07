"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ChartNoAxesCombined, ClipboardList, Dices, Flag, Gamepad2, Gauge, KeyRound, LayoutDashboard, QrCode, Settings, Shield, Users, WandSparkles } from "lucide-react";

const links = [
  ["Overview", "/staff/admin", LayoutDashboard], ["Participants", "/staff/admin/participants", Users], ["Teams", "/staff/admin/teams", Flag],
  ["Games & stations", "/staff/admin/games", Gamepad2], ["Game Masters", "/staff/admin/game-masters", KeyRound], ["Rotations", "/staff/admin/rotations", WandSparkles],
  ["Matches", "/staff/admin/matches", Activity], ["Clues", "/staff/admin/clues", Shield], ["Board games", "/staff/admin/board-games", Dices],
  ["SOLO activities", "/staff/admin/solo-activities", Gauge], ["Reports", "/staff/admin/reports", ChartNoAxesCombined], ["Audit logs", "/staff/admin/audit", ClipboardList],
  ["Settings", "/staff/admin/settings", Settings], ["Announcements", "/staff/admin/announcements", Activity], ["Team QR codes", "/staff/admin/team-qr", QrCode], ["Staff management", "/staff/admin/staff", Users],
] as const;

export default function AdminNavigation({ role }: { role: string }) {
  const pathname = usePathname();
  return <aside className="border-b border-[#e3e8dc] bg-white p-3 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:p-5"><Link href="/staff/admin" className="mb-5 flex items-center gap-3 px-2 py-2"><span className="grid size-10 place-items-center rounded-2xl bg-[#d7f695]"><Activity size={19}/></span><span><b className="block text-sm">YouPulse</b><small className="text-[#829077]">Administration</small></span></Link><nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-1">{links.filter(([label]) => (role === "SUPER_ADMIN" || !["Settings", "Announcements", "Staff management"].includes(label)) || label === "Game Masters").map(([label, href, Icon]) => <Link key={href} href={href} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${pathname === href ? "bg-[#eff6e5] text-[#37572b]" : "text-[#657261] hover:bg-[#f6f8f2]"}`}><Icon size={16}/><span>{label}</span></Link>)}</nav><div className="mt-6 hidden rounded-2xl bg-[#f6f8f2] p-4 text-xs leading-5 text-[#75816c] lg:block"><b className="text-[#34452d]">{role.replaceAll("_", " ")}</b><br/>Administrative access is checked again on every server request.</div></aside>;
}
