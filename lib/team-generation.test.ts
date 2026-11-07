import { describe, expect, it } from "vitest";
import { generateBalancedTeams, teamBalanceReport, validateTeamDraft, validateUnlockReason, type BalanceStudent } from "./team-generation";

function roster(size: number, mode: "TEAM" | "SOLO" = "TEAM"): BalanceStudent[] {
  return Array.from({ length: size }, (_, index) => ({ _id: String(index), fullName: `Student ${index}`, year: (index % 2 ? "A2" : "A1") as "A1" | "A2", className: `Class ${index % 3}`, gender: index % 2 ? "F" : "M", mode }));
}
const ids = (teams:BalanceStudent[][]) => teams.flatMap((team)=>team.map((student)=>String(student._id)));

describe("team generation and structural validation", () => {
  it("returns no teams for zero participants", () => expect(generateBalancedTeams([])).toEqual([]));
  it("rejects one participant under the default six-person policy", () => expect(() => generateBalancedTeams(roster(1))).toThrow("TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE"));
  it("returns no competitive teams for a SOLO-only roster", () => expect(generateBalancedTeams(roster(4,"SOLO"))).toEqual([]));
  it("excludes SOLO participants from a mixed roster", () => { const result=generateBalancedTeams([...roster(12),{...roster(1,"SOLO")[0],_id:"solo"}],6,100,"seed");expect(result).toHaveLength(2);expect(result.flat().every((student)=>student.mode==="TEAM")).toBe(true); });
  it("creates complete fixed-size teams and preserves uniqueness", () => { const result=generateBalancedTeams(roster(24),6,200,"seed");expect(result).toHaveLength(4);expect(result.every((team)=>team.length===6)).toBe(true);expect(new Set(ids(result)).size).toBe(24); });
  it("is reproducible for the same seed", () => expect(ids(generateBalancedTeams(roster(24),6,100,"same"))).toEqual(ids(generateBalancedTeams(roster(24),6,100,"same"))));
  it("reports class, year, gender distributions and a deterministic balance score", () => {
    const generated = generateBalancedTeams(roster(12), 6, 100, "report-seed");
    const report = teamBalanceReport(generated);
    expect(report).toHaveLength(2);
    expect(report.every((team) => team.size === 6 && team.years.A1 === 3 && team.years.A2 === 3 && Number.isFinite(team.balanceScore))).toBe(true);
    expect(teamBalanceReport(generateBalancedTeams(roster(12), 6, 100, "report-seed"))).toEqual(report);
  });
  it("prepares explicit non-divisible arrangements but refuses to apply without approval", () => { const result=generateBalancedTeams(roster(17),6,100,"seed",[6,6,5]);expect(result.map((team)=>team.length)).toEqual([6,6,5]);expect(()=>validateTeamDraft(result.map((team,i)=>({name:`Team ${i}`,studentIds:team.map((s)=>String(s._id))})),roster(17).map((s)=>String(s._id)),false)).toThrow("TEAM_SIZE_POLICY_APPROVAL_REQUIRED"); });
  it("rejects a duplicate roster identity instead of assigning it twice", () => { const duplicate=roster(12);duplicate[11]._id=duplicate[0]._id;expect(()=>generateBalancedTeams(duplicate)).toThrow("DUPLICATE_PARTICIPANTS"); });
  it("validates manual participant exchange without losing or duplicating anyone", () => { const result=generateBalancedTeams(roster(12),6,0,"seed");const a=result[0][0],b=result[1][0];result[0][0]=b;result[1][0]=a;expect(validateTeamDraft(result.map((team,i)=>({name:`Team ${i+1}`,studentIds:team.map((s)=>String(s._id))})),roster(12).map((s)=>String(s._id)),false)).toBe(true); });
  it("blocks repeated generation while teams are locked", () => expect(()=>validateTeamDraft([{name:"Team 1",studentIds:["1"]}],["1"],true)).toThrow("LOCKED_TEAMS_EXIST"));
  it("requires an unlock reason for audit", () => { expect(()=>validateUnlockReason(true," ")).toThrow("UNLOCK_REASON_REQUIRED");expect(validateUnlockReason(true,"Schedule correction")).toBe(true); });
  it("rejects a roster missing a participant", () => expect(()=>validateTeamDraft([{name:"Team 1",studentIds:["1"]}], ["1","2"],false,"approved alternative")).toThrow("PARTICIPANT_SET_MISMATCH"));
});
