import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import { connectDb } from "@/lib/db";
import { StaffUser } from "@/lib/models";

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
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();

        const password = String(credentials?.password ?? "");

        console.log("[AUTH] Login attempt:", email);

        // Vérification des données reçues
        if (!email || !password || password.length > 200) {
          console.log("[AUTH] Invalid input");
          return null;
        }

        try {
          // Connexion MongoDB
          await connectDb();
          console.log("[AUTH] MongoDB connected");

          // Recherche de l'utilisateur
          const user = await StaffUser.findOne({ email }).lean();

          console.log("[AUTH] User found:", !!user);

          if (!user) {
            console.log("[AUTH] User not found");
            return null;
          }

          // Vérification du mot de passe
          const passwordValid = await compare(
            password,
            user.passwordHash
          );

          console.log("[AUTH] Password valid:", passwordValid);

          if (!passwordValid) {
            console.log("[AUTH] Password mismatch");
            return null;
          }

          console.log("[AUTH] Authentication successful");

          return {
            id: String(user._id),
            name: user.name,
            email: user.email,
            role: user.role,
            sessionVersion: user.sessionVersion ?? 0,
          };
        } catch (error) {
          console.error("[AUTH] Authentication error:", error);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id);
        session.user.role = String(token.role);
        session.user.sessionVersion = Number(token.sessionVersion ?? 0);
      }

      return session;
    },
  },
});