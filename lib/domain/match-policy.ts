import { canAccessGame } from "../authorization";

export function assertMatchCreationAllowed(role: string, active: boolean, frozen: boolean, overrideReason?: string) {
  if (!active) throw new Error("GAME_UNAVAILABLE");
  if (frozen && (role !== "SUPER_ADMIN" || (overrideReason?.trim().length ?? 0) < 8)) throw new Error("GAME_FROZEN");
}

export function assertCompetitiveMatchGame(category: string, supportedModes: string[]) {
  if (category !== "COMPETITIVE" || !supportedModes.includes("TEAM")) throw new Error("GAME_MODE_MISMATCH");
}

export function assertMatchOperationAccess(role: string, assignedGameIds: Iterable<string>, gameId: string, operation: "matches.start"|"matches.finish") {
  if (!canAccessGame(role,operation,assignedGameIds,gameId)) throw new Error("FORBIDDEN");
}

export function checkFinishIdempotency(status: string, transitionKeys: string[], storedWinner: string, requestedWinner: string) {
  if (status === "DONE" && transitionKeys.includes("end")) {
    if (storedWinner !== requestedWinner) throw new Error("RESULT_ALREADY_RECORDED");
    return true;
  }
  if (status !== "IN_PROGRESS") throw new Error("INVALID_STATE");
  return false;
}
