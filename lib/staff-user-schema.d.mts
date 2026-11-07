import type { Schema } from "mongoose";

export interface StaffUserAttributes {
  name: string;
  email: string;
  passwordHash: string;
  role: "SUPER_ADMIN" | "ADMIN" | "GAME_MASTER";
  active?: boolean;
  sessionVersion?: number;
}

export const staffUserSchema: Schema<StaffUserAttributes>;
