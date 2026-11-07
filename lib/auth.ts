import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { connectDb } from "@/lib/db";
import { StaffUser } from "@/lib/models";
import { clearLoginAttempts, consumeLoginAttempt } from "@/lib/auth-rate-limit";
import { validateProductionEnvironment } from "@/lib/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/staff/sign-in" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, async authorize(credentials) {
    validateProductionEnvironment();
    const email = String(credentials?.email ?? "").toLowerCase().trim();
    const password = String(credentials?.password ?? "");
    if (!email || !password || password.length > 200) return null;
    try {
      await connectDb();
      if (!await consumeLoginAttempt(email)) return null;
      const user = await StaffUser.findOne({ email, active: true }).lean();
      if (!user || !(await compare(password, user.passwordHash))) return null;
      await clearLoginAttempts(email);
      return { id: String(user._id), name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion ?? 0 };
    } catch { return null; }
  } })],
  callbacks: { async jwt({ token, user }) { if (user) { token.role = (user as typeof user & { role: string }).role; token.id = user.id; token.sessionVersion = (user as typeof user & { sessionVersion: number }).sessionVersion; } return token; }, async session({ session, token }) { if (session.user) { session.user.id = String(token.id); session.user.role = String(token.role); session.user.sessionVersion = Number(token.sessionVersion ?? 0); } return session; } },
});
