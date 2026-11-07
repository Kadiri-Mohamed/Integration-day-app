import { compare, hash } from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  initializeAdmin,
  readAdminBootstrapConfig,
} from "./admin-bootstrap.mjs";

const validEnvironment = {
  MONGODB_URI: "mongodb+srv://db.example.org/youpulse",
  ADMIN_NAME: "  Event Administrator  ",
  ADMIN_EMAIL: "  ADMIN@Example.org ",
  ADMIN_PASSWORD: "a-unique-bootstrap-password",
};

function makeStaffModel(existing: Array<Record<string, unknown>> = []) {
  const records = new Map(existing.map((user) => [String(user.email).toLowerCase(), user]));

  return {
    records,
    collection: { createIndex: vi.fn(async () => "email_1") },
    exists: vi.fn(async ({ email }: { email: string | { $regex: string; $options: string } }) => {
      if (typeof email === "string") return records.get(email) ?? null;
      const matcher = new RegExp(email.$regex, email.$options);
      return [...records.values()].find((user) => matcher.test(String(user.email))) ?? null;
    }),
    create: vi.fn(async (user: Record<string, unknown>) => {
      const email = String(user.email);
      if (records.has(email)) {
        const duplicate = new Error("duplicate key") as Error & { code: number };
        duplicate.code = 11000;
        throw duplicate;
      }
      records.set(email, user);
      return user;
    }),
  };
}

describe("SUPER_ADMIN bootstrap", () => {
  it("validates and normalizes required configuration without exposing values", () => {
    expect(() => readAdminBootstrapConfig({})).toThrow(
      "Missing required environment variables: MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD.",
    );
    expect(readAdminBootstrapConfig(validEnvironment)).toMatchObject({
      name: "Event Administrator",
      email: "admin@example.org",
    });
  });

  it("creates an active SUPER_ADMIN with a bcrypt hash and session version zero", async () => {
    const StaffUser = makeStaffModel();
    const config = readAdminBootstrapConfig(validEnvironment);

    await expect(initializeAdmin({
      StaffUser,
      config,
      hashPassword: (password: string, rounds: number) => hash(password, rounds),
    })).resolves.toEqual({ created: true });

    const user = StaffUser.records.get(config.email)!;
    expect(user).toMatchObject({
      name: "Event Administrator",
      email: "admin@example.org",
      role: "SUPER_ADMIN",
      active: true,
      sessionVersion: 0,
    });
    expect(await compare(config.password, String(user.passwordHash))).toBe(true);
    expect(user.passwordHash).not.toBe(config.password);
  });

  it("reports an existing email without changing its account or hashing the password", async () => {
    const existing = {
      email: "ADMIN@EXAMPLE.ORG",
      role: "ADMIN",
      active: false,
      passwordHash: "unchanged",
    };
    const StaffUser = makeStaffModel([existing]);
    const hashPassword = vi.fn();

    await expect(initializeAdmin({
      StaffUser,
      config: readAdminBootstrapConfig(validEnvironment),
      hashPassword,
    })).resolves.toEqual({ created: false });

    expect(StaffUser.records.get("admin@example.org")).toBe(existing);
    expect(StaffUser.collection.createIndex).not.toHaveBeenCalled();
    expect(StaffUser.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("keeps concurrent initialization attempts idempotent", async () => {
    const StaffUser = makeStaffModel();
    const config = readAdminBootstrapConfig(validEnvironment);
    const hashPassword = vi.fn(async (password: string) => `bcrypt:${password}`);

    const results = await Promise.all([
      initializeAdmin({ StaffUser, config, hashPassword }),
      initializeAdmin({ StaffUser, config, hashPassword }),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    expect(StaffUser.records.size).toBe(1);
  });
});
