export const ROLES = ["SUPER_ADMIN", "ADMIN", "GAME_MASTER"] as const;
export type Role = typeof ROLES[number];

export const ADMIN_OPERATIONS = [
  "overview", "participants.read", "participants.write", "participants.export", "teams.read", "teams.write",
  "games.read", "games.write", "gameMasters.assign", "rotations.read", "rotations.write", "matches.read",
  "matches.write", "clues.manage", "boardGames.manage", "soloActivities.manage", "reports.read", "audit.read",
  "staff.gameMasters.manage",
] as const;

const SUPER_ADMIN_ONLY = new Set(["settings.write", "staff.admins.manage", "event.activate", "event.close", "data.destroy"]);
const GAME_MASTER_OPERATIONS = new Set(["overview", "matches.read", "matches.start", "matches.finish", "games.read"]);

export function can(role: string, operation: string) {
  if (role === "SUPER_ADMIN") return true;
  if (role === "ADMIN") return !SUPER_ADMIN_ONLY.has(operation) && ADMIN_OPERATIONS.includes(operation as typeof ADMIN_OPERATIONS[number]);
  return role === "GAME_MASTER" && GAME_MASTER_OPERATIONS.has(operation);
}

export function canAccessGame(role: string, operation: string, assignedGameIds: Iterable<string>, gameId: string) {
  if (!can(role, operation)) return false;
  return role !== "GAME_MASTER" || new Set(assignedGameIds).has(gameId);
}

export function canManageStaffRole(actorRole: string, targetRole: string, operation: "create" | "update" | "deactivate") {
  if (actorRole === "SUPER_ADMIN") return true;
  return actorRole === "ADMIN" && targetRole === "GAME_MASTER" && ["create", "update", "deactivate"].includes(operation);
}
