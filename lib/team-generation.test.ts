import { describe, expect, it } from "vitest";
import { generateBalancedTeams, type BalanceStudent } from "./team-generation";

function roster(size: number): BalanceStudent[] {
  return Array.from({ length: size }, (_, index) => ({
    _id: String(index), fullName: `Student ${index}`, year: (index % 2 ? "A2" : "A1") as "A1" | "A2",
    className: `Class ${index % 3}`, gender: index % 2 ? "F" : "M", mode: "TEAM",
  }));
}

describe("generateBalancedTeams", () => {
  it("creates complete fixed-size teams and keeps each participant once", () => {
    const result = generateBalancedTeams(roster(24));
    expect(result).toHaveLength(4);
    expect(result.every((team) => team.length === 6)).toBe(true);
    expect(result.flatMap((team) => team.map((student) => student._id))).toHaveLength(24);
    expect(new Set(result.flatMap((team) => team.map((student) => student._id))).size).toBe(24);
  });

  it("never moves SOLO participants into competitive teams", () => {
    const participants = roster(12);
    participants.push({ _id: "solo", fullName: "Solo Player", year: "A1", className: "Class 1", mode: "SOLO" });
    const result = generateBalancedTeams(participants);
    expect(result.flatMap((team) => team).some((student) => student.mode === "SOLO")).toBe(false);
  });

  it("rejects counts that need an unapproved 5 or 7 player team policy", () => {
    expect(() => generateBalancedTeams(roster(13))).toThrow("TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE");
  });
});
