import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { AuditLog, Game, GameAssignment, Match } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(["SUPER_ADMIN","ADMIN"]); const {id}=await params;if(!Types.ObjectId.isValid(id))throw new Error("NOT_FOUND");await connectDb();
    const game=await Game.findById(id).lean();if(!game)throw new Error("NOT_FOUND");
    const [matches,assignments]=await Promise.all([Match.find({game:id}).populate("teams","name").populate("winner","name").populate("assignedGameMaster","name email").sort({createdAt:-1}).limit(500).lean(),GameAssignment.find({game:id}).populate("staffUser","name email active").populate("assignedBy","name email").sort({assignedAt:-1}).lean()]);
    const matchIds=matches.map((match)=>String(match._id));
    const audit=await AuditLog.find({$or:[{targetType:"Game",targetId:id},{targetType:"Match",targetId:{$in:matchIds}}]}).populate("actor","name email role").sort({occurredAt:-1}).limit(500).lean();
    return NextResponse.json({game,matches,assignments,audit});
  }catch(error){const message=error instanceof Error?error.message:"INTERNAL";return NextResponse.json({error:message},{status:message==="FORBIDDEN"?403:message==="UNAUTHENTICATED"?401:message==="NOT_FOUND"?404:503});}
}
