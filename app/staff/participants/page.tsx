import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Activity, ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/permissions";
import ParticipantTools from "./ParticipantTools";

export default async function ParticipantsPage() {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) redirect("/staff/sign-in");
  try { await requireStaff(["ADMIN", "SUPER_ADMIN"]); } catch { redirect("/staff"); }
  return <main className="min-h-screen bg-[#f7f7f2] text-[#172118]"><header className="border-b border-[#e5e8df] bg-white px-6 py-4 lg:px-10"><Link href="/staff" className="flex w-fit items-center gap-2 font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#c3f169]"><Activity size={18}/></span>YouPulse <span className="text-xs font-semibold text-[#879182]">/ Staff</span></Link></header><div className="mx-auto max-w-6xl px-5 py-9 lg:px-8"><Link href="/staff" className="flex items-center gap-1 text-xs font-semibold text-[#85907f]"><ArrowLeft size={14}/> Staff dashboard</Link><p className="mt-6 text-[11px] font-extrabold uppercase tracking-[.14em] text-[#86a956]">Event setup</p><h1 className="mt-1 text-3xl font-black tracking-[-.05em]">Participants & teams</h1><p className="mt-2 text-sm text-[#778172]">Validate student lists, balance team membership, and lock the final composition.</p><ParticipantTools/></div></main>;
}
