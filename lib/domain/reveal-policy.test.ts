import { describe, expect, it } from "vitest";
import { isRevealPublished, publicRevealProjection, validateRevealReadiness } from "./reveal-policy";

describe("final reveal policy", () => {
  it("keeps drafts and incomplete publications private", () => {
    expect(publicRevealProjection({ status: "DRAFT", content: "secret", revealedAt: null })).toBeNull();
    expect(isRevealPublished({ status: "PUBLISHED", content: "secret", revealedAt: null })).toBe(false);
  });
  it("publishes only the authorized final text and timestamp", () => {
    const projection = publicRevealProjection({ status: "PUBLISHED", content: "Final answer", revealedAt: "2026-11-07T10:00:00Z" });
    expect(projection).toEqual({ content: "Final answer", publishedAt: "2026-11-07T10:00:00Z" });
    expect(projection).not.toHaveProperty("team");
    expect(projection).not.toHaveProperty("sourceTemplate");
  });
  it("blocks publication when settings, lifecycle, or clue integrity is incomplete", () => {
    expect(validateRevealReadiness({ enabled: false, eventCompleted: true, completedClueMatches: 2, activeAwardedClues: 2 }).allowed).toBe(false);
    expect(validateRevealReadiness({ enabled: true, eventCompleted: false, completedClueMatches: 2, activeAwardedClues: 2 }).allowed).toBe(false);
    expect(validateRevealReadiness({ enabled: true, eventCompleted: true, completedClueMatches: 2, activeAwardedClues: 1 }).allowed).toBe(false);
    expect(validateRevealReadiness({ enabled: true, eventCompleted: true, completedClueMatches: 2, activeAwardedClues: 2 }).allowed).toBe(true);
  });
});
