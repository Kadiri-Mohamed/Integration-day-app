import { consumeSensitiveOperation } from "@/lib/auth-rate-limit";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("CROSS_ORIGIN_REQUEST");
  const expected = new URL(request.url).origin;
  if (new URL(origin).origin !== expected) throw new Error("CROSS_ORIGIN_REQUEST");
}

export async function assertSensitiveRateLimit(actorId: string, operation: string, maximum = 30) {
  if (!await consumeSensitiveOperation(actorId, operation, maximum)) throw new Error("RATE_LIMITED");
}

export function errorResponseStatus(message: string) {
  if (message === "FORBIDDEN") return 403;
  if (message === "NOT_FOUND") return 404;
  if (["INVALID_STATE", "TEAM_ALREADY_IN_MATCH", "GAME_UNAVAILABLE", "LAST_SUPER_ADMIN", "SELF_ROLE_CHANGE", "CROSS_ORIGIN_REQUEST"].includes(message)) return 409;
  if (message === "UNAUTHENTICATED") return 401;
  if (message === "RATE_LIMITED") return 429;
  return 400;
}
