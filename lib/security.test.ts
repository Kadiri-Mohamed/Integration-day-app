import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./security";

describe("same-origin mutation protection", () => {
  it("accepts same-origin browser requests", () => {
    expect(() => assertSameOrigin(new Request("https://event.example/api/matches/1/end", { method: "POST", headers: { Origin: "https://event.example" } }))).not.toThrow();
  });

  it("rejects cross-origin and origin-less mutation requests", () => {
    expect(() => assertSameOrigin(new Request("https://event.example/api/matches/1/end", { method: "POST", headers: { Origin: "https://attacker.example" } }))).toThrow("CROSS_ORIGIN_REQUEST");
    expect(() => assertSameOrigin(new Request("https://event.example/api/matches/1/end", { method: "POST" }))).toThrow("CROSS_ORIGIN_REQUEST");
  });
});
