import { describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "./env";

describe("production environment validation", () => {
  it("does not impose production-only settings in development", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });

  it("rejects missing and placeholder production credentials without printing their values", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", MONGODB_URI: "mongodb+srv://user:password@cluster.example/db", AUTH_SECRET: "replace-with-a-long-random-secret", AUTH_URL: "http://localhost:3000" })).toThrow("PRODUCTION_ENV_INVALID");
  });

  it("accepts a configured HTTPS deployment", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", MONGODB_URI: "mongodb+srv://test-user:test-password@cluster.mongodb.net/youpulse_prod", AUTH_SECRET: "generated-random-secret-with-at-least-32-characters", AUTH_URL: "https://event.example.org" })).not.toThrow();
  });
});
