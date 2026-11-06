import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { connectDb } from "@/lib/db";
import { StaffUser } from "@/lib/models";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/staff/sign-in" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, async authorize(credentials) {
    const email = String(credentials?.email ?? "").toLowerCase().trim();
    const password = String(credentials?.password ?? "");
    if (!email || !password || password.length > 200) return null;
    try { await connectDb(); const user = await StaffUser.findOne({ email }).lean(); if (!user || !(await compare(password, user.passwordHash))) return null; return { id: String(user._id), name: user.name, email: user.email, role: user.role }; } catch { return null; }
  } })],
  callbacks: { async jwt({ token, user }) { if (user) { token.role = (user as typeof user & { role: string }).role; token.id = user.id; } return token; }, async session({ session, token }) { if (session.user) { session.user.id = String(token.id); session.user.role = String(token.role); } return session; } },
});
