import AdminWorkspace from "./AdminWorkspace";
import { requireStaff } from "@/lib/permissions";
export default async function AdminHome() { const staff = await requireStaff(["SUPER_ADMIN", "ADMIN"]); return <AdminWorkspace section="overview" role={staff.role}/>; }
