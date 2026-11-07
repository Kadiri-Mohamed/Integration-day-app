import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireStaff } from "@/lib/permissions";
import AdminNavigation from "./AdminNavigation";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth(); if (!session?.user) redirect("/staff/sign-in");
  let staff; try { staff = await requireStaff(["SUPER_ADMIN", "ADMIN"]); } catch { redirect("/staff"); }
  return <div className="min-h-screen bg-[#f6f7f2] text-[#172118] lg:flex"><AdminNavigation role={staff.role}/><div className="min-w-0 flex-1">{children}</div></div>;
}
