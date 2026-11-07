import { notFound, redirect } from "next/navigation";
import AdminWorkspace from "../AdminWorkspace";
import RotationPlanner from "../RotationPlanner";
import { requireStaff } from "@/lib/permissions";

const sections = new Set(["participants","teams","games","game-masters","rotations","slots","matches","clues","board-games","solo-activities","participations","board-assignments","reports","audit","settings","announcements","staff"]);
export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params; if (!sections.has(section)) notFound();
  let staff; try { staff = await requireStaff(["SUPER_ADMIN", "ADMIN"]); } catch { redirect("/staff"); }
  if (staff.role === "ADMIN" && ["settings","announcements","staff"].includes(section)) redirect("/staff/admin/game-masters");
  if (section === "rotations") return <RotationPlanner/>;
  return <AdminWorkspace section={section} role={staff.role}/>;
}
