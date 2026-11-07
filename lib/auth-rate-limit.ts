import { createHash } from "node:crypto";
import { AuthAttempt } from "@/lib/models";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_LOGIN_ATTEMPTS = 5;

function rateKey(email: string) { return createHash("sha256").update(email.trim().toLowerCase()).digest("hex"); }

export async function consumeLoginAttempt(email: string) {
  return consumeWindow(`login:${rateKey(email)}`, MAX_LOGIN_ATTEMPTS, WINDOW_MS);
}

export async function clearLoginAttempts(email: string) { await AuthAttempt.deleteOne({ key: `login:${rateKey(email)}` }); }

export async function consumeSensitiveOperation(actorId: string, operation: string, maximum = 30) {
  return consumeWindow(`operation:${rateKey(`${actorId}:${operation}`)}`, maximum, 60_000);
}

async function consumeWindow(key: string, maximum: number, windowMs: number) {
  const now = new Date();
  const record = await AuthAttempt.findOneAndUpdate({ key }, [{ $set: { count: { $cond: [{ $gt: ["$expiresAt", now] }, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] }, expiresAt: { $cond: [{ $gt: ["$expiresAt", now] }, "$expiresAt", { $dateAdd: { startDate: now, unit: "millisecond", amount: windowMs } }] } } }], { upsert: true, new: true, setDefaultsOnInsert: true, updatePipeline: true });
  return record.count <= maximum;
}
