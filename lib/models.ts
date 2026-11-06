import mongoose, { Schema, models, model } from "mongoose";

const StudentSchema = new Schema({ fullName: { type: String, required: true, trim: true }, year: { type: String, enum: ["A1", "A2"], required: true }, className: { type: String, required: true }, gender: { type: String, enum: ["F", "M", "X", "UNSPECIFIED"], default: "UNSPECIFIED" }, mode: { type: String, enum: ["TEAM", "SOLO"], default: "TEAM", index: true }, team: { type: Schema.Types.ObjectId, ref: "Team", default: null } }, { timestamps: true });
StudentSchema.index({ fullName: 1, className: 1 }, { unique: true });

const TeamSchema = new Schema({ name: { type: String, required: true, unique: true }, slug: { type: String, required: true, unique: true }, color: { type: String, default: "#c3f169" }, locked: { type: Boolean, default: false } }, { timestamps: true });
const GameSchema = new Schema({ name: { type: String, required: true, unique: true }, description: String, category: { type: String, enum: ["COMPETITIVE", "BOARD"], default: "COMPETITIVE" }, active: { type: Boolean, default: true }, frozen: { type: Boolean, default: false }, masters: [{ type: Schema.Types.ObjectId, ref: "StaffUser" }] }, { timestamps: true });
const MatchSchema = new Schema({ game: { type: Schema.Types.ObjectId, ref: "Game", required: true, index: true }, teams: [{ type: Schema.Types.ObjectId, ref: "Team", required: true }], round: { type: Number, required: true }, status: { type: String, enum: ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"], default: "PENDING", index: true }, winner: { type: Schema.Types.ObjectId, ref: "Team", default: null }, startedAt: Date, completedAt: Date, idempotencyKey: { type: String, unique: true, sparse: true } }, { timestamps: true });
MatchSchema.index({ game: 1, round: 1, teams: 1 }, { unique: true });
const ClueSchema = new Schema({ match: { type: Schema.Types.ObjectId, ref: "Match", required: true, unique: true }, team: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true }, content: { type: String, required: true }, awardedAt: { type: Date, default: Date.now } }, { timestamps: true });
const ClueTemplateSchema = new Schema({ game: { type: Schema.Types.ObjectId, ref: "Game", required: true, index: true }, content: { type: String, required: true }, used: { type: Boolean, default: false, index: true } }, { timestamps: true });
const StaffSchema = new Schema({ name: { type: String, required: true }, email: { type: String, required: true, unique: true, lowercase: true }, passwordHash: { type: String, required: true }, role: { type: String, enum: ["SUPER_ADMIN", "ADMIN", "GAME_MASTER"], default: "GAME_MASTER" }, assignedGames: [{ type: Schema.Types.ObjectId, ref: "Game" }] }, { timestamps: true });
const AuditSchema = new Schema({ actor: { type: Schema.Types.ObjectId, ref: "StaffUser", default: null }, action: { type: String, required: true }, targetType: { type: String, required: true }, targetId: { type: String, required: true }, previous: Schema.Types.Mixed, next: Schema.Types.Mixed, reason: String }, { timestamps: true, strict: true });
AuditSchema.pre("findOneAndDelete", function () { throw new Error("Audit records are immutable"); });
AuditSchema.pre("deleteMany", function () { throw new Error("Audit records are immutable"); });
export const Student = models.Student || model("Student", StudentSchema);
export const Team = models.Team || model("Team", TeamSchema);
export const Game = models.Game || model("Game", GameSchema);
export const Match = models.Match || model("Match", MatchSchema);
export const Clue = models.Clue || model("Clue", ClueSchema);
export const ClueTemplate = models.ClueTemplate || model("ClueTemplate", ClueTemplateSchema);
export const StaffUser = models.StaffUser || model("StaffUser", StaffSchema);
export const AuditLog = models.AuditLog || model("AuditLog", AuditSchema);
export const modelObjectId = mongoose.Types.ObjectId;
