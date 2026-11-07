import { describe, expect, it } from "vitest";
import { exposeStaffSession, persistStaffInToken } from "./auth-callbacks";

describe("staff session callbacks", () => {
  it("preserves SUPER_ADMIN role and session version from credentials through JWT and session", () => {
    const token = persistStaffInToken({
      token: {},
      user: {
        id: "staff-id",
        name: "Event Administrator",
        email: "admin@example.org",
        role: "SUPER_ADMIN",
        sessionVersion: 0,
      },
    });
    const session = exposeStaffSession({
      token,
      session: {
        expires: "2030-01-01T00:00:00.000Z",
        user: { id: "", name: null, email: null, image: null, role: "", sessionVersion: -1 },
      },
    });

    expect(token.role).toBe("SUPER_ADMIN");
    expect(session.user.role).toBe("SUPER_ADMIN");
    expect(session.user.sessionVersion).toBe(0);
  });
});
