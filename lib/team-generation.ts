export type BalanceStudent = { _id: unknown; fullName: string; year: "A1" | "A2"; className: string; gender?: string; mode: "TEAM" | "SOLO" };
type Bucket = { students: BalanceStudent[]; years: Map<string, number>; classes: Map<string, number>; genders: Map<string, number> };
const bucket = (): Bucket => ({ students: [], years: new Map(), classes: new Map(), genders: new Map() });
const count = (map: Map<string, number>, key: string) => map.get(key) ?? 0;
function add(team: Bucket, student: BalanceStudent) {
  team.students.push(student);
  for (const [map, key] of [[team.years, student.year], [team.classes, student.className], [team.genders, student.gender ?? "UNSPECIFIED"]] as [Map<string, number>, string][]) map.set(key, count(map, key) + 1);
}
function distributionScore(team: Bucket) {
  const score = (map: Map<string, number>, weight: number) => [...map.values()].reduce((sum, value) => sum + value * value, 0) * weight;
  return score(team.years, 0.7) + score(team.classes, 1) + score(team.genders, 0.55);
}
function randomFor(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(items: T[], random: () => number) { return [...items].map((item) => ({ item, rank: random() })).sort((a, b) => a.rank - b.rank).map(({ item }) => item); }

/** Team sizes are only varied when an administrator explicitly supplies a proposed arrangement. */
export function generateBalancedTeams(input: BalanceStudent[], targetSize = 6, iterations = 1200, seed = "youpulse", proposedTeamSizes?: number[]) {
  if (!Number.isInteger(targetSize) || targetSize < 1 || targetSize > 100) throw new Error("INVALID_TARGET_SIZE");
  const participants = input.filter((student) => student.mode === "TEAM");
  const ids = participants.map((student) => String(student._id));
  if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_PARTICIPANTS");
  if (!participants.length) return [];
  const teamSizes = proposedTeamSizes ?? (participants.length % targetSize === 0 ? Array(participants.length / targetSize).fill(targetSize) : null);
  if (!teamSizes || teamSizes.some((size) => !Number.isInteger(size) || size < 1 || size > 100) || teamSizes.reduce((sum, size) => sum + size, 0) !== participants.length) throw new Error("TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE");
  const random = randomFor(seed);
  const shuffledParticipants = shuffled(participants, random);
  const teams = teamSizes.map(() => bucket());
  const keyCount = new Map<string, number>();
  for (const student of shuffledParticipants) { const key = `${student.year}|${student.className}|${student.gender ?? "UNSPECIFIED"}`; keyCount.set(key, count(keyCount, key) + 1); }
  shuffledParticipants.sort((a, b) => count(keyCount, `${b.year}|${b.className}|${b.gender ?? "UNSPECIFIED"}`) - count(keyCount, `${a.year}|${a.className}|${a.gender ?? "UNSPECIFIED"}`));
  for (const student of shuffledParticipants) {
    const eligible = teams.map((team, index) => ({ team, index })).filter(({ team, index }) => team.students.length < teamSizes[index]);
    const scored = eligible.map(({ team, index }) => ({ team, score: distributionScore(team) + random() * 0.08, index }));
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    add(scored[0].team, student);
  }
  // Deterministic local-search swaps improve global balance without changing team sizes.
  for (let i = 0; i < Math.max(0, iterations); i++) {
    if (teams.length < 2) break;
    const ai = Math.floor(random() * teams.length), bi = (ai + 1 + Math.floor(random() * (teams.length - 1))) % teams.length;
    const a = teams[ai], b = teams[bi];
    const aIndex = Math.floor(random() * a.students.length), bIndex = Math.floor(random() * b.students.length);
    const sa = a.students[aIndex], sb = b.students[bIndex];
    if (!sa || !sb) continue;
    const oldScore = distributionScore(a) + distributionScore(b);
    a.students[aIndex] = sb; b.students[bIndex] = sa;
    const mapFor = (team: Bucket) => { for (const m of [team.years, team.classes, team.genders]) m.clear(); for (const s of team.students) for (const [m, key] of [[team.years, s.year], [team.classes, s.className], [team.genders, s.gender ?? "UNSPECIFIED"]] as [Map<string, number>, string][]) m.set(key, count(m, key) + 1); };
    mapFor(a); mapFor(b);
    if (distributionScore(a) + distributionScore(b) > oldScore) { a.students[aIndex] = sa; b.students[bIndex] = sb; mapFor(a); mapFor(b); }
  }
  return teams.map((team) => shuffled(team.students, random));
}

export function teamBalanceReport(teams: BalanceStudent[][]) {
  const distribution = (members: BalanceStudent[], key: "year" | "className" | "gender") => members.reduce<Record<string, number>>((out, student) => { const value = key === "gender" ? student.gender ?? "UNSPECIFIED" : student[key]; out[value] = (out[value] ?? 0) + 1; return out; }, {});
  return teams.map((members) => ({ size: members.length, years: distribution(members, "year"), classes: distribution(members, "className"), genders: distribution(members, "gender"), balanceScore: distributionScore((() => { const b = bucket(); members.forEach((s) => add(b, s)); return b; })()) }));
}

export function validateTeamDraft(teams: { studentIds: string[]; name: string }[], participantIds: string[], locked: boolean, policyApproval?: string) {
  if (locked) throw new Error("LOCKED_TEAMS_EXIST");
  if (!teams.length || teams.some((team) => team.name.trim().length < 2 || !team.studentIds.length)) throw new Error("INVALID_TEAM_DRAFT");
  const assigned = teams.flatMap((team) => team.studentIds);
  if (new Set(assigned).size !== assigned.length) throw new Error("DUPLICATE_PARTICIPANTS");
  if ([...assigned].sort().join(",") !== [...participantIds].sort().join(",")) throw new Error("PARTICIPANT_SET_MISMATCH");
  if (teams.some((team) => team.studentIds.length !== 6) && (policyApproval?.trim().length ?? 0) < 10) throw new Error("TEAM_SIZE_POLICY_APPROVAL_REQUIRED");
  return true;
}

export function validateUnlockReason(locked: boolean, reason: string) {
  if (!locked) throw new Error("NO_LOCKED_TEAMS");
  if (reason.trim().length < 8) throw new Error("UNLOCK_REASON_REQUIRED");
  return true;
}
