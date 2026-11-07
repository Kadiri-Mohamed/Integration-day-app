import { z } from "zod";

const productionSchema = z.object({
  MONGODB_URI: z.string().min(1).refine((value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"), "must be a MongoDB connection URI").refine((value) => !/[<>]|cluster\.example|user:password|placeholder/i.test(value), "must not contain template placeholder values"),
  AUTH_SECRET: z.string().min(32, "must contain at least 32 characters").refine((value) => !/replace|placeholder|example|secret$/i.test(value), "must be a generated secret, not a placeholder"),
  AUTH_URL: z.string().url().refine((value) => value.startsWith("https://"), "must use HTTPS in production"),
});

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const result = productionSchema.safeParse(env);
  if (!result.success) throw new Error(`PRODUCTION_ENV_INVALID:${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}
