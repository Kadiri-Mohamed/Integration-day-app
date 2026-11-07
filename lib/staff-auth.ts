import { compare } from "bcryptjs";

import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/auth-rate-limit";
import { connectDb } from "@/lib/db";
import { StaffUser } from "@/lib/models";

export async function authenticateStaff(credentials: Partial<Record<string, unknown>> | undefined) {
  const email = String(credentials?.email ?? "").toLowerCase().trim();
  const password = String(credentials?.password ?? "");

  if (!email || !password || password.length > 200) return null;

  await connectDb();
  if (!await consumeLoginAttempt(email)) return null;

  const user = await StaffUser.findOne({ email }).lean();
  if (!user) return null;

  const passwordValid = await compare(password, user.passwordHash);
  if (!passwordValid || user.active !== true) return null;

  await clearLoginAttempts(email);

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion ?? 0,
  };
}
