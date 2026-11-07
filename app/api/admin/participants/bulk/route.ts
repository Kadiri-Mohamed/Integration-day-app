import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { AuditLog, Student, Team } from "@/lib/models";
import { requireStaff } from "@/lib/permissions";
import { assertSameOrigin, assertSensitiveRateLimit } from "@/lib/security";

const schema = z.object({ studentIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(500), status: z.literal("INACTIVE") }).strict().refine((value)=>new Set(value.studentIds).size===value.studentIds.length);
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request); const actor = await requireStaff(["SUPER_ADMIN","ADMIN"]); await assertSensitiveRateLimit(actor.id,"participant-bulk",5); const input=schema.parse(await request.json()); await connectDb(); const session=await Student.db.startSession(); let updated=0;
    try { await session.withTransaction(async()=>{
      const students=await Student.find({_id:{$in:input.studentIds},status:"ACTIVE"}).session(session);
      if(students.length!==input.studentIds.length)throw new Error("PARTICIPANT_SET_MISMATCH");
      const ids=students.map((student)=>student._id);
      if(await Team.exists({locked:true,members:{$in:ids}}).session(session))throw new Error("TEAM_LOCKED");
      await Team.updateMany({members:{$in:ids}},{$pull:{members:{$in:ids}}},{session});
      const result=await Student.updateMany({_id:{$in:ids},status:"ACTIVE"},{$set:{status:"INACTIVE",team:null}},{session});updated=result.modifiedCount;
      await AuditLog.create([{actor:actor.id,action:"PARTICIPANTS_BULK_DEACTIVATED",targetType:"StudentBatch",targetId:input.studentIds.join(","),next:{count:updated,studentIds:input.studentIds}}],{session});
    }); } finally { await session.endSession(); }
    return NextResponse.json({updated});
  }catch(error){const message=error instanceof Error?error.message:"INTERNAL";return NextResponse.json({error:message},{status:message==="FORBIDDEN"?403:message==="UNAUTHENTICATED"?401:message==="RATE_LIMITED"?429:["PARTICIPANT_SET_MISMATCH","TEAM_LOCKED"].includes(message)?409:400});}
}
