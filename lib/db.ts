import mongoose from "mongoose";
import { validateProductionEnvironment } from "@/lib/env";

const uri = process.env.MONGODB_URI;

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = globalThis as typeof globalThis & { mongooseCache?: Cache };
const cache = globalWithMongoose.mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.mongooseCache = cache;

export async function connectDb() {
  validateProductionEnvironment();
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (cache.conn) return cache.conn;
  // Index creation is explicit via scripts/migrate-domain.mjs so legacy data is
  // checked before any new unique indexes are attempted.
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, autoIndex: false, serverSelectionTimeoutMS: 10_000 }).catch((error) => { cache.promise = null; throw error; });
  cache.conn = await cache.promise;
  return cache.conn;
}
