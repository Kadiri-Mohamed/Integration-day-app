export type ScheduleTeam = { id: string; name: string };
export type ScheduleGame = { id: string; name: string; station: string; active: boolean; frozen: boolean; supportedModes: string[]; teamsPerMatch: number; stationCapacity?: number | null };
export type SchedulePolicy = { approved: boolean; oddTeamPolicy: "UNCONFIGURED" | "BLOCK" | "BYE" | "WAITING"; capacityOverflowPolicy: "UNCONFIGURED" | "BLOCK" | "WAITING" };
export type PlannedMatch = { id: string; gameId: string; gameName: string; station: string; teams: ScheduleTeam[] };
export type PlannedRound = { number: number; startAt: string; endAt: string; matches: PlannedMatch[]; waitingTeams: ScheduleTeam[] };
export type ScheduleConflict = { code: string; message: string; round?: number; teamIds?: string[]; gameId?: string };
export type SchedulePlan = { rounds: PlannedRound[]; conflicts: ScheduleConflict[]; unusedGames: ScheduleGame[]; estimatedCompletion: string | null; workload: Array<{ gameId: string; gameName: string; station: string; matches: number; teamAssignments: number }> };

export type ScheduleInput = {
  teams: ScheduleTeam[];
  games: ScheduleGame[];
  rotationCount: number;
  rotationDurationMinutes: number;
  breakDurationMinutes: number;
  startAt: Date;
  eventEndAt?: Date | null;
  policy: SchedulePolicy;
  existingReservations?: Array<{ round: number; gameId: string; teamIds: string[] }>;
  previousAssignments?: string[];
};

export function eventTimeToUtc(eventDate: Date | null, time: string | null, timeZone: string | null) {
  if (!eventDate || !time || !timeZone) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const year = eventDate.getUTCFullYear(), month = eventDate.getUTCMonth() + 1, day = eventDate.getUTCDate();
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = expected;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = formatter.formatToParts(new Date(candidate));
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
      const difference = expected - represented;
      if (!difference) break;
      candidate += difference;
    }
    const parts = formatter.formatToParts(new Date(candidate));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    if (get("year") !== year || get("month") !== month || get("day") !== day || get("hour") !== hour || get("minute") !== minute) return null;
    return new Date(candidate);
  } catch { return null; }
}

/** Deterministic first-fit rotation planner. It never hides unassigned teams or constraint failures. */
export function generateSchedule(input: ScheduleInput): SchedulePlan {
  const conflicts: ScheduleConflict[] = [];
  const teamIds = input.teams.map((team) => team.id);
  if (!input.teams.length) conflicts.push({ code: "NO_TEAMS", message: "No validated teams are available for the rotation plan." });
  if (new Set(teamIds).size !== teamIds.length) conflicts.push({ code: "DUPLICATE_TEAM", message: "The team list contains duplicate IDs." });
  if (input.rotationCount < 1 || input.rotationDurationMinutes < 1) conflicts.push({ code: "INVALID_EVENT_TIMING", message: "Rotation count and duration must be positive." });
  if (input.eventEndAt && input.eventEndAt <= input.startAt) conflicts.push({ code: "INVALID_EVENT_WINDOW", message: "The configured event end must be later than its start time." });
  if (!input.policy.approved || input.policy.oddTeamPolicy === "UNCONFIGURED" || input.policy.capacityOverflowPolicy === "UNCONFIGURED") conflicts.push({ code: "POLICY_NOT_APPROVED", message: "Approve explicit odd-team and capacity-overflow policies before validating or publishing a schedule." });
  const seenStation = new Set<string>();
  for (const game of input.games.filter((candidate) => candidate.active && !candidate.frozen && candidate.supportedModes.includes("TEAM"))) {
    if (!game.station.trim()) conflicts.push({ code: "MISSING_STATION", message: `${game.name} has no station configured.`, gameId: game.id });
    if (!Number.isInteger(game.stationCapacity) || (game.stationCapacity ?? 0) < 1) conflicts.push({ code: "MISSING_STATION_CAPACITY", message: `${game.name} needs an approved station capacity of at least one match.`, gameId: game.id });
    const key = game.station.trim().toLocaleLowerCase("en-US");
    if (key && seenStation.has(key)) conflicts.push({ code: "DUPLICATE_STATION", message: `Station ${game.station} is assigned to more than one active game.`, gameId: game.id });
    if (key) seenStation.add(key);
    if (!Number.isInteger(game.teamsPerMatch) || game.teamsPerMatch < 2) conflicts.push({ code: "INVALID_MATCH_CAPACITY", message: `${game.name} must have at least two teams per competitive match.`, gameId: game.id });
  }
  const games = input.games.filter((game) => game.active && !game.frozen && game.supportedModes.includes("TEAM") && game.station.trim() && Number.isInteger(game.stationCapacity) && (game.stationCapacity ?? 0) > 0 && Number.isInteger(game.teamsPerMatch) && game.teamsPerMatch >= 2);
  if (!games.length) conflicts.push({ code: "NO_AVAILABLE_STATIONS", message: "No active, unfrozen competitive games have valid stations and capacity." });
  if (input.policy.oddTeamPolicy === "UNCONFIGURED" && input.teams.length % 2 === 1) conflicts.push({ code: "ODD_TEAM_POLICY_REQUIRED", message: "An odd number of teams requires an explicitly approved BYE or waiting rule." });

  const reservations = new Set((input.existingReservations ?? []).flatMap((reservation) => reservation.teamIds.map((teamId) => `${reservation.round}:${reservation.gameId}:${teamId}`)));
  const pairsPlayed = new Set<string>(input.previousAssignments ?? []);
  const rounds: PlannedRound[] = [];
  const workload = new Map<string, { gameId: string; gameName: string; station: string; matches: number; teamAssignments: number }>();
  let cursor = input.startAt.getTime();
  for (let number = 1; number <= input.rotationCount; number += 1) {
    const start = cursor;
    const end = start + input.rotationDurationMinutes * 60_000;
    const busy = new Set<string>();
    for (const reservation of input.existingReservations ?? []) if (reservation.round === number) for (const teamId of reservation.teamIds) busy.add(teamId);
    const available = input.teams.filter((team) => !busy.has(team.id));
    const matches: PlannedMatch[] = [];
    const waitingTeams: ScheduleTeam[] = [];
    let gameOffset = (number - 1) % Math.max(1, games.length);
    for (let visited = 0; visited < games.length; visited += 1) {
      const game = games[gameOffset];
      gameOffset = (gameOffset + 1) % games.length;
      const reservedAtStation = (input.existingReservations ?? []).filter((reservation) => reservation.round === number && reservation.gameId === game.id).length;
      const freeCapacity = Math.max(0, (game.stationCapacity ?? 0) - reservedAtStation);
      for (let stationMatch = 0; stationMatch < freeCapacity; stationMatch += 1) {
        const selected: ScheduleTeam[] = [];
        for (const team of available) {
          if (selected.length >= game.teamsPerMatch) break;
          if (busy.has(team.id) || selected.some((candidate) => candidate.id === team.id)) continue;
          const pairKey = `${team.id}:${game.id}`;
          if (pairsPlayed.has(pairKey) || reservations.has(`${number}:${game.id}:${team.id}`)) continue;
          selected.push(team);
        }
        if (selected.length !== game.teamsPerMatch) continue;
        for (const team of selected) { busy.add(team.id); pairsPlayed.add(`${team.id}:${game.id}`); }
        const id = `${number}:${game.id}:${stationMatch + 1}`;
        matches.push({ id, gameId: game.id, gameName: game.name, station: game.station, teams: selected });
        const stat = workload.get(game.id) ?? { gameId: game.id, gameName: game.name, station: game.station, matches: 0, teamAssignments: 0 };
        stat.matches += 1; stat.teamAssignments += selected.length; workload.set(game.id, stat);
      }
    }
    const remaining = input.teams.filter((team) => !busy.has(team.id));
    waitingTeams.push(...remaining);
    const singleByeAllowed = input.policy.oddTeamPolicy === "BYE" && input.teams.length % 2 === 1 && remaining.length === 1;
    const waitingAllowed = input.policy.capacityOverflowPolicy === "WAITING" || input.policy.oddTeamPolicy === "WAITING";
    if (remaining.length && !waitingAllowed && !singleByeAllowed) conflicts.push({ code: "UNASSIGNED_TEAMS", message: `${remaining.length} team(s) do not fit this rotation and no approved waiting/BYE rule allows it.`, round: number, teamIds: remaining.map((team) => team.id) });
    if (singleByeAllowed) {
      // A BYE is explicit and visible in the waitingTeams preview; it does not create a match.
    }
    rounds.push({ number, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), matches, waitingTeams });
    cursor = end + input.breakDurationMinutes * 60_000;
  }
  const used = new Set(rounds.flatMap((round) => round.matches.map((match) => match.gameId)));
  const eligible = input.games.filter((game) => game.active && !game.frozen && game.supportedModes.includes("TEAM"));
  const roundsByNumber = new Map<number, Set<string>>();
  for (const reservation of input.existingReservations ?? []) {
    const set = roundsByNumber.get(reservation.round) ?? new Set<string>();
    for (const id of reservation.teamIds) { if (set.has(id)) conflicts.push({ code: "TEAM_DOUBLE_BOOKED", message: `Team ${id} is already reserved more than once in rotation ${reservation.round}.`, round: reservation.round, teamIds: [id] }); set.add(id); }
    roundsByNumber.set(reservation.round, set);
  }
  const scheduleEnd = rounds.length ? rounds.at(-1)!.endAt : null;
  if (scheduleEnd && input.eventEndAt && new Date(scheduleEnd) > input.eventEndAt) conflicts.push({ code: "EVENT_WINDOW_EXCEEDED", message: "The rotations and breaks extend beyond the configured event end time." });
  return { rounds, conflicts, unusedGames: eligible.filter((game) => !used.has(game.id)), estimatedCompletion: scheduleEnd, workload: [...workload.values()].sort((a, b) => a.gameName.localeCompare(b.gameName)) };
}

export function validateSchedule(plan: SchedulePlan, teamsPerGame: Map<string, number>, stationCapacities: Map<string, number>) {
  const conflicts = [...plan.conflicts];
  const played = new Set<string>();
  for (const round of plan.rounds) {
    const seenTeams = new Set<string>();
    const stationCounts = new Map<string, number>();
    for (const match of round.matches) {
      stationCounts.set(match.gameId, (stationCounts.get(match.gameId) ?? 0) + 1);
      if (match.teams.length !== teamsPerGame.get(match.gameId)) conflicts.push({ code: "MATCH_SIZE_MISMATCH", message: `${match.gameName} has an invalid team count in rotation ${round.number}.`, round: round.number, gameId: match.gameId });
      for (const team of match.teams) { if (seenTeams.has(team.id)) conflicts.push({ code: "TEAM_DOUBLE_BOOKED", message: `Team ${team.name} is booked more than once in rotation ${round.number}.`, round: round.number, teamIds: [team.id] }); seenTeams.add(team.id); const key = `${team.id}:${match.gameId}`; if (played.has(key)) conflicts.push({ code: "REPEATED_TEAM_GAME", message: `Team ${team.name} is assigned to ${match.gameName} more than once.`, round: round.number, teamIds: [team.id], gameId: match.gameId }); played.add(key); }
    }
    for (const [gameId, count] of stationCounts) if (count > (stationCapacities.get(gameId) ?? 0)) conflicts.push({ code: "STATION_OVER_CAPACITY", message: `Station for game ${gameId} exceeds its capacity in rotation ${round.number}.`, round: round.number, gameId });
  }
  return conflicts;
}

export function swapTeamsInRound(plan: SchedulePlan, roundNumber: number, teamAId: string, teamBId: string, teamsPerGame: Map<string, number>, stationCapacities: Map<string, number>) {
  const updated = structuredClone(plan) as SchedulePlan;
  const round = updated.rounds.find((item) => item.number === roundNumber);
  if (!round || teamAId === teamBId) return { plan: updated, conflicts: [{ code: "INVALID_SWAP", message: "Select two different teams in an existing rotation." }] as ScheduleConflict[] };
  const find = (id: string) => {
    for (const match of round.matches) { const index = match.teams.findIndex((team) => team.id === id); if (index >= 0) return { team: match.teams[index], match, index, waiting: false }; }
    const index = round.waitingTeams.findIndex((team) => team.id === id);
    return index >= 0 ? { team: round.waitingTeams[index], index, waiting: true } : null;
  };
  const a = find(teamAId), b = find(teamBId);
  if (!a || !b) return { plan: updated, conflicts: [{ code: "TEAM_NOT_IN_ROTATION", message: "Both teams must be assigned or waiting in the selected rotation." }] as ScheduleConflict[] };
  const teamA = a.team, teamB = b.team;
  if (!a.waiting && !b.waiting && a.match && b.match) { a.match.teams[a.index] = teamB; b.match.teams[b.index] = teamA; }
  else if (!a.waiting && a.match) { a.match.teams[a.index] = teamB; round.waitingTeams[b.index] = teamA; }
  else if (!b.waiting && b.match) { b.match.teams[b.index] = teamA; round.waitingTeams[a.index] = teamB; }
  else { round.waitingTeams[a.index] = teamB; round.waitingTeams[b.index] = teamA; }
  const conflicts = validateSchedule({ ...updated, conflicts: [] }, teamsPerGame, stationCapacities);
  return { plan: updated, conflicts };
}

/** Rebuild one draft round while preserving every other round and avoiding games already used elsewhere. */
export function regenerateRound(plan: SchedulePlan, roundNumber: number, teams: ScheduleTeam[], games: ScheduleGame[], rotationDurationMinutes: number, policy: SchedulePolicy) {
  const target = plan.rounds.find((round) => round.number === roundNumber);
  if (!target) return { plan, conflicts: [{ code: "ROTATION_NOT_FOUND", message: "The requested rotation does not exist." }] as ScheduleConflict[] };
  const previousAssignments = plan.rounds.filter((round) => round.number !== roundNumber).flatMap((round) => round.matches.flatMap((match) => match.teams.map((team) => `${team.id}:${match.gameId}`)));
  const rebuilt = generateSchedule({ teams, games, rotationCount: 1, rotationDurationMinutes, breakDurationMinutes: 0, startAt: new Date(target.startAt), eventEndAt: new Date(target.endAt), policy, previousAssignments });
  if (rebuilt.conflicts.length) return { plan, conflicts: rebuilt.conflicts };
  const updated = structuredClone(plan) as SchedulePlan;
  const replacement = { ...rebuilt.rounds[0], number: roundNumber };
  updated.rounds = updated.rounds.map((round) => round.number === roundNumber ? replacement : round);
  const used = new Set(updated.rounds.flatMap((round) => round.matches.map((match) => match.gameId)));
  updated.unusedGames = games.filter((game) => game.active && !game.frozen && game.supportedModes.includes("TEAM") && !used.has(game.id));
  const priorWorkload = new Map<string, SchedulePlan["workload"][number]>();
  for (const round of updated.rounds) for (const match of round.matches) {
    const stat = priorWorkload.get(match.gameId) ?? { gameId: match.gameId, gameName: match.gameName, station: match.station, matches: 0, teamAssignments: 0 };
    stat.matches += 1; stat.teamAssignments += match.teams.length; priorWorkload.set(match.gameId, stat);
  }
  updated.workload = [...priorWorkload.values()].sort((a, b) => a.gameName.localeCompare(b.gameName));
  return { plan: updated, conflicts: validateSchedule({ ...updated, conflicts: [] }, new Map(games.map((game) => [game.id, game.teamsPerMatch])), new Map(games.map((game) => [game.id, game.stationCapacity ?? 0]))) };
}
