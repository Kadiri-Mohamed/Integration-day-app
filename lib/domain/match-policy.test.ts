import { describe,expect,it } from "vitest";
import { assertCompetitiveMatchGame, assertMatchCreationAllowed, assertMatchOperationAccess, checkFinishIdempotency } from "./match-policy";

describe("game assignment and match operation policy",()=>{
  it("keeps BOARD and SOLO activities out of competitive matches",()=>{
    expect(()=>assertCompetitiveMatchGame("COMPETITIVE",["TEAM"])).not.toThrow();
    expect(()=>assertCompetitiveMatchGame("BOARD",["TEAM"])).toThrow("GAME_MODE_MISMATCH");
    expect(()=>assertCompetitiveMatchGame("SOLO",["SOLO"])).toThrow("GAME_MODE_MISMATCH");
  });
  it("allows assigned Game Masters on Game A and rejects Game B",()=>{
    expect(()=>assertMatchOperationAccess("GAME_MASTER",["game-a"],"game-a","matches.start")).not.toThrow();
    expect(()=>assertMatchOperationAccess("GAME_MASTER",["game-a"],"game-b","matches.start")).toThrow("FORBIDDEN");
    expect(()=>assertMatchOperationAccess("GAME_MASTER",["game-a"],"game-a","matches.finish")).not.toThrow();
    expect(()=>assertMatchOperationAccess("GAME_MASTER",[],"game-a","matches.finish")).toThrow("FORBIDDEN");
  });
  it("blocks new matches for inactive or frozen games without a super-admin override",()=>{
    expect(()=>assertMatchCreationAllowed("ADMIN",false,false)).toThrow("GAME_UNAVAILABLE");
    expect(()=>assertMatchCreationAllowed("ADMIN",true,true,"Approved event exception")).toThrow("GAME_FROZEN");
    expect(()=>assertMatchCreationAllowed("SUPER_ADMIN",true,true)).toThrow("GAME_FROZEN");
    expect(()=>assertMatchCreationAllowed("SUPER_ADMIN",true,true,"Approved by director")).not.toThrow();
  });
  it("allows an idempotent repeat only for the same recorded winner",()=>{
    expect(checkFinishIdempotency("DONE",["end"],"team-a","team-a")).toBe(true);
    expect(()=>checkFinishIdempotency("DONE",["end"],"team-a","team-b")).toThrow("RESULT_ALREADY_RECORDED");
    expect(()=>checkFinishIdempotency("PENDING",[],"","team-a")).toThrow("INVALID_STATE");
    expect(checkFinishIdempotency("IN_PROGRESS",[],"","team-a")).toBe(false);
  });
});
