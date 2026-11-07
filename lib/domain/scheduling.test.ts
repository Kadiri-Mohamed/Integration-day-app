import { describe, expect, it } from "vitest";
import { Rotation, RotationSlot } from "../models";
import { eventTimeToUtc, generateSchedule, regenerateRound, swapTeamsInRound, validateSchedule, type ScheduleGame, type SchedulePolicy, type ScheduleTeam } from "./scheduling";

const teams = (count: number): ScheduleTeam[] => Array.from({ length: count }, (_, index) => ({ id: `t${index + 1}`, name: `Team ${index + 1}` }));
const games = (count: number, capacity = 1): ScheduleGame[] => Array.from({ length: count }, (_, index) => ({ id: `g${index + 1}`, name: `Game ${index + 1}`, station: `Station ${index + 1}`, active: true, frozen: false, supportedModes: ["TEAM"], teamsPerMatch: 2, stationCapacity: capacity }));
const policy: SchedulePolicy = { approved: true, oddTeamPolicy: "WAITING", capacityOverflowPolicy: "WAITING" };
const plan = (count: number, gameCount: number, overrides: Partial<SchedulePolicy> = {}, gameOverrides: Partial<ScheduleGame>[] = []) => {
  const selectedGames = games(gameCount).map((game, index) => ({ ...game, ...gameOverrides[index] }));
  return generateSchedule({ teams: teams(count), games: selectedGames, rotationCount: 3, rotationDurationMinutes: 20, breakDurationMinutes: 10, startAt: new Date("2026-11-06T09:00:00.000Z"), policy: { ...policy, ...overrides } });
};

describe("rotation scheduling engine", () => {
  it("schedules different team and game counts without double booking a team", () => {
    for (const [teamCount, gameCount] of [[4, 2], [8, 3], [12, 4]]) {
      const generated = plan(teamCount, gameCount);
      for (const round of generated.rounds) {
        const assigned = round.matches.flatMap((match) => match.teams.map((team) => team.id));
        expect(new Set(assigned).size).toBe(assigned.length);
      }
      expect(validateSchedule(generated, new Map(games(gameCount).map((game) => [game.id, 2])), new Map(games(gameCount).map((game) => [game.id, 1])))).toEqual([]);
    }
  });
  it("reports unconfigured policy and requires an explicit decision for odd teams", () => {
    const missingApproval = plan(3, 2, { approved: false, oddTeamPolicy: "UNCONFIGURED", capacityOverflowPolicy: "UNCONFIGURED" });
    expect(missingApproval.conflicts.map((conflict) => conflict.code)).toContain("POLICY_NOT_APPROVED");
    expect(missingApproval.conflicts.map((conflict) => conflict.code)).toContain("ODD_TEAM_POLICY_REQUIRED");
  });
  it("accepts one explicitly approved BYE but does not use BYE to hide capacity overflow", () => {
    const bye = generateSchedule({ teams: teams(3), games: games(2), rotationCount: 1, rotationDurationMinutes: 20, breakDurationMinutes: 0, startAt: new Date(), policy: { ...policy, oddTeamPolicy: "BYE", capacityOverflowPolicy: "BLOCK" } });
    expect(bye.conflicts.map((conflict) => conflict.code)).not.toContain("UNASSIGNED_TEAMS");
    expect(bye.rounds[0].waitingTeams).toHaveLength(1);
    const overflow = plan(5, 1, { oddTeamPolicy: "BYE", capacityOverflowPolicy: "BLOCK" });
    expect(overflow.conflicts.map((conflict) => conflict.code)).toContain("UNASSIGNED_TEAMS");
  });
  it("blocks a station with missing capacity and excludes frozen games", () => {
    const generated = plan(4, 2, {}, [{ stationCapacity: null }, { frozen: true }]);
    expect(generated.conflicts.map((conflict) => conflict.code)).toContain("MISSING_STATION_CAPACITY");
    expect(generated.rounds.every((round) => round.matches.every((match) => match.gameId !== "g2"))).toBe(true);
  });
  it("reports teams who cannot fit within declared capacities using the approved waiting policy", () => {
    const generated = plan(6, 1, {}, [{ stationCapacity: 1 }]);
    expect(generated.rounds[0].waitingTeams.map((team) => team.id)).toEqual(["t3", "t4", "t5", "t6"]);
    expect(generated.conflicts.some((conflict) => conflict.code === "UNASSIGNED_TEAMS")).toBe(false);
  });
  it("supports station capacities greater than one and prevents team/game repeats", () => {
    const gamesWithCapacity = games(2, 2);
    const generated = generateSchedule({ teams: teams(8), games: gamesWithCapacity, rotationCount: 2, rotationDurationMinutes: 15, breakDurationMinutes: 5, startAt: new Date("2026-11-06T09:00:00Z"), policy });
    expect(generated.rounds[0].matches).toHaveLength(4);
    const assignments = generated.rounds.flatMap((round) => round.matches.flatMap((match) => match.teams.map((team) => `${team.id}:${match.gameId}`)));
    expect(new Set(assignments).size).toBe(assignments.length);
    expect(generated.rounds[1].startAt).toBe("2026-11-06T09:20:00.000Z");
  });
  it("honors unequal station capacities and reservations made by existing matches", () => {
    const unevenGames = games(3).map((game, index) => ({ ...game, stationCapacity: index + 1 }));
    const generated = generateSchedule({ teams: teams(12), games: unevenGames, rotationCount: 1, rotationDurationMinutes: 20, breakDurationMinutes: 0, startAt: new Date(), policy, existingReservations: [{ round: 1, gameId: "g2", teamIds: ["t1", "t2"] }] });
    expect(generated.rounds[0].matches.filter((match) => match.gameId === "g2")).toHaveLength(1);
    expect(generated.rounds[0].matches.filter((match) => match.gameId === "g1")).toHaveLength(1);
    expect(generated.rounds[0].matches.filter((match) => match.gameId === "g3")).toHaveLength(3);
    const assigned = generated.rounds[0].matches.flatMap((match) => match.teams.map((team) => team.id));
    expect(new Set(assigned).size).toBe(assigned.length);
  });
  it("surfaces duplicate station conflicts and existing double bookings", () => {
    const selected = games(2).map((game) => ({ ...game, station: "Shared station" }));
    const generated = generateSchedule({ teams: teams(4), games: selected, rotationCount: 1, rotationDurationMinutes: 20, breakDurationMinutes: 0, startAt: new Date(), policy, existingReservations: [{ round: 1, gameId: "g1", teamIds: ["t1"] }, { round: 1, gameId: "g2", teamIds: ["t1"] }] });
    expect(generated.conflicts.map((conflict) => conflict.code)).toContain("DUPLICATE_STATION");
    expect(generated.conflicts.map((conflict) => conflict.code)).toContain("TEAM_DOUBLE_BOOKED");
  });
  it("handles empty participant lists and no available games as explicit planning failures", () => {
    const noTeams = generateSchedule({ teams: [], games: games(1), rotationCount: 2, rotationDurationMinutes: 20, breakDurationMinutes: 0, startAt: new Date(), policy });
    expect(noTeams.rounds).toHaveLength(2);
    expect(noTeams.rounds.every((round) => round.matches.length === 0)).toBe(true);
    expect(noTeams.conflicts.map((conflict) => conflict.code)).toContain("NO_TEAMS");
  });
  it("allows an exchange only if every rotation remains conflict-free", () => {
    const generated = generateSchedule({ teams: teams(4), games: games(2), rotationCount: 2, rotationDurationMinutes: 20, breakDurationMinutes: 0, startAt: new Date(), policy });
    const capacity = new Map([["g1", 1], ["g2", 1]]);
    const repeatedGameSwap = swapTeamsInRound(generated, 2, "t1", "t3", new Map([["g1", 2], ["g2", 2]]), capacity);
    expect(repeatedGameSwap.conflicts.map((conflict) => conflict.code)).toContain("REPEATED_TEAM_GAME");
    const oneRound = { ...generated, rounds: [generated.rounds[0]] };
    const validSwap = swapTeamsInRound(oneRound, 1, "t1", "t3", new Map([["g1", 2], ["g2", 2]]), capacity);
    expect(validSwap.conflicts).toEqual([]);
    expect(validSwap.plan.rounds[0].matches.flatMap((match) => match.teams.map((team) => team.id))).toEqual(["t3", "t2", "t1", "t4"]);
  });
  it("regenerates one rotation without changing the other saved rotations", () => {
    const sourceGames = games(4);
    const generated = generateSchedule({ teams: teams(4), games: sourceGames, rotationCount: 3, rotationDurationMinutes: 20, breakDurationMinutes: 10, startAt: new Date("2026-11-06T09:00:00Z"), policy });
    const originalFirst = JSON.stringify(generated.rounds[0]);
    const result = regenerateRound(generated, 2, teams(4), sourceGames, 20, policy);
    expect(result.conflicts).toEqual([]);
    expect(JSON.stringify(result.plan.rounds[0])).toBe(originalFirst);
    expect(result.plan.rounds[1].number).toBe(2);
    expect(result.plan.rounds[2]).toEqual(generated.rounds[2]);
    expect(validateSchedule(result.plan, new Map(sourceGames.map((game) => [game.id, game.teamsPerMatch])), new Map(sourceGames.map((game) => [game.id, game.stationCapacity ?? 0])))).toEqual([]);
  });
  it("requires an explicit time zone and converts event wall time correctly", () => {
    const date = new Date("2026-11-06T00:00:00.000Z");
    expect(eventTimeToUtc(date, "09:00", null)).toBeNull();
    expect(eventTimeToUtc(date, "09:00", "Etc/UTC")?.toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect(eventTimeToUtc(new Date("2026-03-08T00:00:00.000Z"), "02:30", "America/New_York")).toBeNull();
  });
  it("declares schedule version and station-slot uniqueness indexes", () => {
    expect(Rotation.schema.indexes().some(([keys, options]) => keys.eventVersion === 1 && options.unique === true)).toBe(true);
    expect(RotationSlot.schema.indexes().some(([keys, options]) => keys.rotation === 1 && keys.sequence === 1 && keys.stationKey === 1 && keys.ordinal === 1 && options.unique === true)).toBe(true);
  });
});
