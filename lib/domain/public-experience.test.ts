import { describe, expect, it } from "vitest";
import { rankPublicTeams } from "./leaderboard";
import { publicTeamUrl } from "../public-url";

describe("public team views", () => {
  it("gives tied clue counts the same competition rank with stable alphabetical ordering", () => {
    const ranked = rankPublicTeams([{ name: "Beta", slug: "beta", clues: 2 }, { name: "Gamma", slug: "gamma", clues: 1 }, { name: "Alpha", slug: "alpha", clues: 2 }]);
    expect(ranked.map(({ name, rank }) => [name, rank])).toEqual([["Alpha", 1], ["Beta", 1], ["Gamma", 3]]);
  });

  it("builds QR-safe canonical public team URLs without credentials or query data", () => {
    expect(publicTeamUrl("red-team", "https://event.example/api/admin/teams/qr-export")).toBe("https://event.example/teams/red-team");
    expect(publicTeamUrl("alpha team", "https://event.example/any")).toBe("https://event.example/teams/alpha%20team");
  });
});
