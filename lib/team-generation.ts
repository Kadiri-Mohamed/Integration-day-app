export type BalanceStudent = { _id: unknown; fullName: string; year: "A1" | "A2"; className: string; gender?: string; mode: "TEAM" | "SOLO" };
type Bucket = { students: BalanceStudent[]; years: Map<string, number>; classes: Map<string, number>; genders: Map<string, number> };

function bucket(): Bucket { return { students: [], years: new Map(), classes: new Map(), genders: new Map() }; }
function count(map: Map<string, number>, key: string) { return map.get(key) ?? 0; }
function add(team: Bucket, student: BalanceStudent, delta: number) {
  team.students.push(...(delta > 0 ? [student] : []));
  if (delta < 0) team.students.splice(team.students.findIndex((entry) => entry === student), 1);
  for (const [map, key] of [[team.years, student.year], [team.classes, student.className], [team.genders, student.gender ?? "UNSPECIFIED"]] as [Map<string, number>, string][]) {
    const next = count(map, key) + delta;
    if (next) map.set(key, next); else map.delete(key);
  }
}
function penalty(team: Bucket, student: BalanceStudent) {
  const size = team.students.length;
  const dimensions = [[team.years, student.year, 0.7], [team.classes, student.className, 1], [team.genders, student.gender ?? "UNSPECIFIED", 0.55]] as [Map<string, number>, string, number][];
  return dimensions.reduce((sum, [map, key, weight]) => sum + weight * (count(map, key) / Math.max(1, size)), 0);
}
function distributionScore(team: Bucket) {
  const score = (map: Map<string, number>, weight: number) => {
    const values = [...map.values()];
    return values.reduce((sum, value) => sum + value * value, 0) * weight;
  };
  return score(team.years, 0.7) + score(team.classes, 1) + score(team.genders, 0.55);
}
function shuffle<T>(items: T[]) { return items.map((item) => ({ item, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map(({ item }) => item); }

export function generateBalancedTeams(input: BalanceStudent[], targetSize = 6, iterations = 1200) {
  const participants = shuffle(input.filter((student) => student.mode === "TEAM"));
  if (!participants.length || participants.length % targetSize !== 0) throw new Error("TEAM_COUNT_MUST_DIVIDE_TARGET_SIZE");
  const size = participants.length / targetSize;
  const teams = Array.from({ length: size }, bucket);
  participants.sort((a, b) => {
    const key = (student: BalanceStudent) => `${student.year}|${student.className}|${student.gender ?? "UNSPECIFIED"}`;
    return participants.filter((student) => key(student) === key(a)).length - participants.filter((student) => key(student) === key(b)).length;
  });
  for (const student of participants) {
    const options = teams.filter((team) => team.students.length < targetSize).map((team) => ({ team, score: penalty(team, student) + Math.random() * 0.08 }));
    add(options.sort((a, b) => a.score - b.score)[0].team, student, 1);
  }
  for (let i = 0; i < iterations; i++) {
    const first = Math.floor(Math.random() * teams.length);
    let second = Math.floor(Math.random() * (teams.length - 1)); if (second >= first) second++;
    const a = teams[first], b = teams[second];
    if (!a || !b || !a.students.length || !b.students.length) continue;
    const indexA = Math.floor(Math.random() * a.students.length), indexB = Math.floor(Math.random() * b.students.length);
    const studentA = a.students[indexA], studentB = b.students[indexB];
    if (!studentA || !studentB) continue;
    const previous = distributionScore(a) + distributionScore(b);
    add(a, studentA, -1); add(b, studentB, -1); add(a, studentB, 1); add(b, studentA, 1);
    const next = distributionScore(a) + distributionScore(b);
    if (next > previous) { add(a, studentB, -1); add(b, studentA, -1); add(a, studentA, 1); add(b, studentB, 1); }
  }
  return teams.map((team) => shuffle(team.students));
}
