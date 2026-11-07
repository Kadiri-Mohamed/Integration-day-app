import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

export function persistStaffInToken({ token, user }: { token: JWT; user?: User }) {
  if (user) {
    token.id = user.id;
    token.role = user.role;
    token.sessionVersion = user.sessionVersion;
  }

  return token;
}

export function exposeStaffSession({ session, token }: { session: Session; token: JWT }) {
  if (session.user) {
    session.user.id = String(token.id);
    session.user.role = String(token.role);
    session.user.sessionVersion = Number(token.sessionVersion ?? 0);
  }

  return session;
}
