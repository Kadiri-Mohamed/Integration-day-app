import { describe, expect, it } from "vitest";
import { ADMIN_OPERATIONS, can, canAccessGame, canManageStaffRole } from "./authorization";

describe("role authorization policy", () => {
  it("grants every defined operation to SUPER_ADMIN", () => {
    for (const operation of [...ADMIN_OPERATIONS, "settings.write", "staff.admins.manage", "event.activate", "event.close", "data.destroy", "matches.start", "matches.finish"]) expect(can("SUPER_ADMIN", operation)).toBe(true);
  });
  it("limits ADMIN to operational features", () => {
    for (const operation of ADMIN_OPERATIONS) expect(can("ADMIN", operation)).toBe(true);
    for (const operation of ["settings.write", "staff.admins.manage", "event.activate", "event.close", "data.destroy"]) expect(can("ADMIN", operation)).toBe(false);
  });
  it("limits GAME_MASTER actions and scopes every game operation to assignment", () => {
    for (const operation of ["overview", "matches.read", "matches.start", "matches.finish", "games.read"]) expect(can("GAME_MASTER", operation)).toBe(true);
    for (const operation of ["participants.read", "teams.write", "clues.manage", "audit.read", "settings.write", "staff.gameMasters.manage"]) expect(can("GAME_MASTER", operation)).toBe(false);
    expect(canAccessGame("GAME_MASTER", "matches.start", ["game-a"], "game-a")).toBe(true);
    expect(canAccessGame("GAME_MASTER", "matches.start", ["game-a"], "game-b")).toBe(false);
    expect(canAccessGame("GAME_MASTER", "clues.manage", ["game-a"], "game-a")).toBe(false);
  });
  it("allows ADMIN to manage Game Masters but not admins or super admins", () => {
    expect(canManageStaffRole("ADMIN", "GAME_MASTER", "create")).toBe(true);
    expect(canManageStaffRole("ADMIN", "ADMIN", "update")).toBe(false);
    expect(canManageStaffRole("ADMIN", "SUPER_ADMIN", "deactivate")).toBe(false);
    expect(canManageStaffRole("SUPER_ADMIN", "SUPER_ADMIN", "update")).toBe(true);
  });
});
