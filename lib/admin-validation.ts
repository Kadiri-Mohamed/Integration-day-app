import { z } from "zod";

export const staffCreateSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()), role: z.enum(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]), password: z.string().min(14).max(200), gameIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).default([]) }).strict();
export const staffUpdateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()).optional(), role: z.enum(["SUPER_ADMIN", "ADMIN", "GAME_MASTER"]).optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0);
export const staffPasswordSchema = z.object({ password: z.string().min(14).max(200) }).strict();
export const staffAssignmentsSchema = z.object({ gameIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100) }).strict().refine((value) => new Set(value.gameIds).size === value.gameIds.length);
export const participantUpdateSchema = z.object({ fullName: z.string().trim().min(2).max(120), year: z.enum(["A1", "A2"]), className: z.string().trim().min(1).max(50), gender: z.enum(["F", "M", "X", "UNSPECIFIED"]), mode: z.enum(["TEAM", "SOLO"]), status: z.enum(["ACTIVE", "INACTIVE"]) }).partial().strict().refine((value) => Object.keys(value).length > 0);

export function actorMayManageStaff(actorRole: string, targetRole: string) {
  return actorRole === "SUPER_ADMIN" || (actorRole === "ADMIN" && targetRole === "GAME_MASTER");
}
