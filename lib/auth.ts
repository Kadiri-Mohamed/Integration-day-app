import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { exposeStaffSession, persistStaffInToken } from "@/lib/auth-callbacks";
import { authenticateStaff } from "@/lib/staff-auth";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 heures
  },

  pages: {
    signIn: "/staff/sign-in",
  },

  providers: [
    Credentials({
      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },
      async authorize(credentials) {
        return authenticateStaff(credentials);
      },
    }),
  ],

  callbacks: {
    jwt: persistStaffInToken,
    session: exposeStaffSession,
  },
});