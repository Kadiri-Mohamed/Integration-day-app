import Link from "next/link";
import { connectDb } from "@/lib/db";
import { SoloActivity } from "@/lib/models";
export const dynamic = "force-dynamic";

export default async function SoloActivitiesPage() {
  let activities: { name: string; description: string; rules: string; station: string; availableSeats: number | null; capacity: number | null }[] = [];
  try {
    await connectDb(); const records = await SoloActivity.find({ active: true, available: true }).select("name description rules station capacity seatsTaken").sort({ name: 1 }).lean();
    activities = records.map(activity => ({ name: activity.name, description: activity.description, rules: activity.rules, station: activity.station, capacity: activity.capacity ?? null, availableSeats: activity.capacity == null ? null : Math.max(0, activity.capacity - activity.seatsTaken) }));
  } catch { activities = []; }
  return <main className="min-h-screen bg-[#f7f7f2] px-5 py-8 text-[#172118] sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/" className="text-sm font-bold text-[#587447]">← YouPulse home</Link><p className="mt-8 text-xs font-extrabold uppercase tracking-[.14em] text-[#81a858]">Recreational activities</p><h1 className="mt-2 text-4xl font-black">SOLO activities</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#6d776a]">Choose an individual activity and check in with its supervisor. SOLO participation stays separate from competitive teams, matches, and clue rewards. Ask a supervisor at the listed location for availability and participation guidance.</p>
    {!activities.length ? <p className="mt-8 rounded-2xl bg-white p-6 text-sm text-[#778472]">SOLO activities will appear when organizers publish availability.</p> : <div className="mt-8 grid gap-4 md:grid-cols-2">{activities.map(activity=><article key={activity.name} className="rounded-2xl border border-[#e3e8de] bg-white p-6"><h2 className="text-xl font-extrabold">{activity.name}</h2><p className="mt-2 text-sm leading-6 text-[#6d776a]">{activity.description}</p>{activity.rules&&<p className="mt-4 whitespace-pre-wrap text-sm"><b>Rules:</b> {activity.rules}</p>}<div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-[#74816d]"><span className="rounded-lg bg-[#f4f7ef] px-3 py-2">Location: {activity.station||"Ask an organizer"}</span><span className="rounded-lg bg-[#f4f7ef] px-3 py-2">{activity.availableSeats===null?"Availability: ask supervisor":`${activity.availableSeats} of ${activity.capacity} seats available`}</span></div></article>)}</div>}</div></main>;
}
