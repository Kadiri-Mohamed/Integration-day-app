import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { hash } from "bcryptjs";
import { connectDb } from "@/lib/db";
import { AuditLog, Game, GameAssignment, Match, StaffUser } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";
import { actorMayManageStaff, staffCreateSchema } from "@/lib/admin-validation";

export async function GET() {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await connectDb();
    const filter = actor.role === "ADMIN" ? { role: "GAME_MASTER" } : {};
    const users = await StaffUser.find(filter).select("name email role active createdAt updatedAt").sort({ name: 1 }).lean();
    const availableGames=await Game.find({active:true}).select("name station").sort({name:1}).lean();
    const assignments = await GameAssignment.find({ active: true }).populate("game", "name station active frozen").select("staffUser game assignedAt").lean();
    const gameIds=assignments.map((assignment)=>assignment.game).filter(Boolean).map((game)=>String((game as {_id:unknown})._id));
    const activeWorkload=await Match.aggregate([{$match:{game:{$in:gameIds.map((id)=>new Types.ObjectId(id))},status:{$in:["PENDING","IN_PROGRESS"]}}},{$group:{_id:"$game",count:{$sum:1}}}]);
    const workloadByGame=new Map(activeWorkload.map((row:{_id:unknown;count:number})=>[String(row._id),row.count]));
    const activity = await AuditLog.find({ $or: [{ actor: { $in: users.map((u) => u._id) } }, { targetId: { $in: users.map((u) => String(u._id)) } }] }).sort({ occurredAt: -1 }).limit(300).select("actor action targetType targetId reason occurredAt").lean();
    return NextResponse.json({ games:availableGames,staff: users.map((user) => {const assigned=assignments.filter((a) => String(a.staffUser) === String(user._id)).map((a) => a.game);return {...user,assignments:assigned,workload:assigned.reduce((sum,game)=>sum+(game?workloadByGame.get(String((game as {_id:unknown})._id))??0:0),0)};}), activity });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : 503 }); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]); await assertSensitiveRateLimit(actor.id, "staff-create", 15); const input = staffCreateSchema.parse(await request.json());
    if (!actorMayManageStaff(actor.role, input.role)) throw new Error("FORBIDDEN");
    if (input.role !== "GAME_MASTER" && input.gameIds.length) throw new Error("INVALID_ASSIGNMENTS");
    await connectDb(); const session = await StaffUser.db.startSession(); let createdId = "";
    try { await session.withTransaction(async () => {
      if (await StaffUser.exists({ email: input.email }).session(session)) throw new Error("EMAIL_EXISTS");
      if (input.gameIds.length && await Game.countDocuments({ _id: { $in: input.gameIds } }).session(session) !== input.gameIds.length) throw new Error("INVALID_ASSIGNMENTS");
      const [user] = await StaffUser.create([{ name: input.name, email: input.email, role: input.role, active: true, passwordHash: await hash(input.password, 12) }], { session });
      if (input.gameIds.length) await GameAssignment.insertMany(input.gameIds.map((game) => ({ game, staffUser: user._id, assignedBy: actor.id, active: true })), { session });
      const [audit] = await AuditLog.create([{ actor: actor.id, action: "STAFF_CREATED", targetType: "StaffUser", targetId: user.id, next: { name: user.name, email: user.email, role: user.role, active: true, gameIds: input.gameIds } }], { session });
      createdId = user.id; void audit;
    }); } finally { await session.endSession(); }
    return NextResponse.json({ id: createdId }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "INTERNAL"; const dup = Boolean(error && typeof error === "object" && "code" in error && error.code === 11000); return NextResponse.json({ error: dup ? "EMAIL_EXISTS" : message }, { status: message === "FORBIDDEN" ? 403 : message === "UNAUTHENTICATED" ? 401 : message === "RATE_LIMITED" ? 429 : message === "EMAIL_EXISTS" || dup ? 409 : 400 }); }
}
