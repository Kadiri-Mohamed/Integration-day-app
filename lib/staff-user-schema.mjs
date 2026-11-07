import { Schema } from "mongoose";

export const staffUserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["SUPER_ADMIN", "ADMIN", "GAME_MASTER"], required: true },
  active: { type: Boolean, default: true },
  sessionVersion: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

staffUserSchema.index({ email: 1 }, { unique: true });
