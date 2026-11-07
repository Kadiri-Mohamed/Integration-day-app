import "next-auth";
declare module "next-auth" { interface Session { user: { id: string; role: string; sessionVersion?: number } & DefaultSession["user"] } interface User { role: string; sessionVersion: number } }
declare module "next-auth/jwt" { interface JWT { role?: string; id?: string; sessionVersion?: number } }
