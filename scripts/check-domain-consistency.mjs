import mongoose from "mongoose";
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required; consistency check was not run");
await mongoose.connect(uri, { autoIndex: false, bufferCommands: false });
const db = mongoose.connection.db;
try {
  const [soloAssigned, brokenTeamBackrefs, brokenStudentBackrefs, activeOverlap, danglingAssignments] = await Promise.all([
    db.collection("students").countDocuments({ mode: "SOLO", team: { $ne: null } }),
    db.collection("teams").aggregate([{ $unwind: "$members" }, { $lookup: { from: "students", localField: "members", foreignField: "_id", as: "student" } }, { $match: { $expr: { $or: [{ $eq: [{ $size: "$student" }, 0] }, { $ne: [{ $arrayElemAt: ["$student.team", 0] }, "$_id"] }, { $eq: [{ $arrayElemAt: ["$student.mode", 0] }, "SOLO"] }] } } }, { $count: "count" }]).toArray(),
    db.collection("students").aggregate([{ $match: { team: { $ne: null } } }, { $lookup: { from: "teams", localField: "team", foreignField: "_id", as: "teamDoc" } }, { $match: { $expr: { $or: [{ $eq: [{ $size: "$teamDoc" }, 0] }, { $not: [{ $in: ["$_id", { $ifNull: [{ $arrayElemAt: ["$teamDoc.members", 0] }, []] }] }] }, { $eq: ["$mode", "SOLO"] }] } } }, { $count: "count" }]).toArray(),
    db.collection("matches").aggregate([{ $match: { status: "IN_PROGRESS" } }, { $unwind: "$teams" }, { $group: { _id: "$teams", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $count: "count" }]).toArray(),
    db.collection("gameassignments").aggregate([{ $lookup: { from: "games", localField: "game", foreignField: "_id", as: "gameDoc" } }, { $lookup: { from: "staffusers", localField: "staffUser", foreignField: "_id", as: "staffDoc" } }, { $match: { $or: [{ gameDoc: { $size: 0 } }, { staffDoc: { $size: 0 } }] } }, { $count: "count" }]).toArray(),
  ]);
  const report = { soloParticipantsAssignedToTeams: soloAssigned, teamMemberBackrefErrors: brokenTeamBackrefs[0]?.count ?? 0, studentTeamBackrefErrors: brokenStudentBackrefs[0]?.count ?? 0, teamsInMultipleActiveMatches: activeOverlap[0]?.count ?? 0, danglingGameAssignments: danglingAssignments[0]?.count ?? 0 };
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report).some((count) => count > 0)) process.exitCode = 1;
} finally { await mongoose.disconnect(); }
