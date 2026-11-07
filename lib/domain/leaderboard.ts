export type PublicRankEntry = { clues: number; name: string; slug: string };
export function rankPublicTeams<T extends PublicRankEntry>(teams: T[]): (T & { rank: number })[] {
  const sorted = [...teams].sort((a, b) => b.clues - a.clues || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  let previous: number | null = null, rank = 0;
  return sorted.map((team, index) => { if (team.clues !== previous) rank = index + 1; previous = team.clues; return { ...team, rank }; });
}
