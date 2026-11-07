import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectDb: vi.fn(),
  clearLoginAttempts: vi.fn(),
  consumeLoginAttempt: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectDb: mocks.connectDb }));
vi.mock("@/lib/models", () => ({ StaffUser: { findOne: mocks.findOne } }));
vi.mock("@/lib/auth-rate-limit", () => ({
  clearLoginAttempts: mocks.clearLoginAttempts,
  consumeLoginAttempt: mocks.consumeLoginAttempt,
}));

import { authenticateStaff } from "./staff-auth";

describe("staff credentials authentication", () => {
  let passwordHash: string;
  const user = {
    _id: "staff-id",
    name: "Event Administrator",
    email: "admin@example.org",
    role: "SUPER_ADMIN",
    active: true,
    sessionVersion: 0,
    passwordHash: "",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    passwordHash = await hash("correct-password", 4);
    user.passwordHash = passwordHash;
    mocks.consumeLoginAttempt.mockResolvedValue(true);
    mocks.clearLoginAttempts.mockResolvedValue(undefined);
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(user) });
  });

  it("normalizes the email and preserves the SUPER_ADMIN role in the authenticated user", async () => {
    await expect(authenticateStaff({
      email: "  ADMIN@Example.org ",
      password: "correct-password",
    })).resolves.toEqual({
      id: "staff-id",
      name: "Event Administrator",
      email: "admin@example.org",
      role: "SUPER_ADMIN",
      sessionVersion: 0,
    });

    expect(mocks.findOne).toHaveBeenCalledWith({ email: "admin@example.org" });
    expect(mocks.clearLoginAttempts).toHaveBeenCalledWith("admin@example.org");
  });

  it("rejects an incorrect password with the generic credentials failure", async () => {
    await expect(authenticateStaff({
      email: "admin@example.org",
      password: "incorrect-password",
    })).resolves.toBeNull();
    expect(mocks.clearLoginAttempts).not.toHaveBeenCalled();
  });

  it("rejects an inactive account even when the password is correct", async () => {
    mocks.findOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ ...user, active: false }),
    });

    await expect(authenticateStaff({
      email: "admin@example.org",
      password: "correct-password",
    })).resolves.toBeNull();
    expect(mocks.clearLoginAttempts).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited login before looking up the user", async () => {
    mocks.consumeLoginAttempt.mockResolvedValue(false);

    await expect(authenticateStaff({
      email: "admin@example.org",
      password: "correct-password",
    })).resolves.toBeNull();
    expect(mocks.findOne).not.toHaveBeenCalled();
  });
});
