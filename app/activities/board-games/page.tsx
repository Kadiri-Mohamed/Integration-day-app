import Link from "next/link";
import { connectDb } from "@/lib/db";
import { BoardGame, BoardGameSession } from "@/lib/models";
export const dynamic = "force-dynamic";

export default async function BoardGamesPage() {
  let cards: { name: string; description: string; rules: string; station: string; sessions: { label: string; start: string; end: string; openSeats: number }[] }[] = [];
  try {
    await connectDb(); const boards = await BoardGame.find({ active: true }).select("name description rules station capacity").sort({ name: 1 }).lean();
    cards = await Promise.all(boards.map(async board => {
      const sessions = await BoardGameSession.find({ boardGame: board._id, status: { $in: ["SCHEDULED", "IN_PROGRESS"] }, endAt: { $gt: new Date() } }).select("label startAt endAt capacity seatsTaken").sort({ startAt: 1 }).lean();
      return { name: board.name, description: board.description, rules: board.rules, station: board.station, sessions: sessions.map(s => ({ label: s.label, start: s.startAt.toISOString(), end: s.endAt.toISOString(), openSeats: Math.max(0, s.capacity - s.seatsTaken) })) };
    }));
  } catch { cards = []; }
  return <main className="min-h-screen bg-[#f7f7f2] px-5 py-8 text-[#172118] sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/" className="text-sm font-bold text-[#587447]">← YouPulse home</Link><p className="mt-8 text-xs font-extrabold uppercase tracking-[.14em] text-[#81a858]">Recreational activities</p><h1 className="mt-2 text-4xl font-black">Board games</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#6d776a]">Drop in for a board game session. These activities are separate from the competitive team stations and do not affect team scores or clues. Ask the supervisor at the listed location to join.</p>
    {!cards.length ? <p className="mt-8 rounded-2xl bg-white p-6 text-sm text-[#778472]">Board games and sessions will appear when organizers publish them.</p> : <div className="mt-8 grid gap-4 md:grid-cols-2">{cards.map(game => <article key={game.name} className="rounded-2xl border border-[#e3e8de] bg-white p-6"><h2 className="text-xl font-extrabold">{game.name}</h2><p className="mt-2 text-sm leading-6 text-[#6d776a]">{game.description}</p>{game.rules&&<p className="mt-4 whitespace-pre-wrap text-sm"><b>Rules:</b> {game.rules}</p>}<p className="mt-3 text-xs font-bold text-[#74816d]">Location: {game.station||"Ask an organizer"}</p><div className="mt-5 border-t pt-4"><h3 className="text-xs font-extrabold uppercase tracking-wide">Sessions and seats</h3>{game.sessions.length?game.sessions.map((s,index)=><p key={`${s.start}-${index}`} className="mt-2 text-sm">{s.label||"Session"} · {new Date(s.start).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",timeZone:"UTC"})}–{new Date(s.end).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",timeZone:"UTC"})} UTC · {s.openSeats} seats available</p>):<p className="mt-2 text-sm text-[#778472]">No upcoming sessions listed.</p>}</div></article>)}</div>}</div></main>;
}
