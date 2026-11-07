import mongoose from "mongoose";

/** @typedef {{ conn: import("mongoose").Mongoose | null; promise: Promise<import("mongoose").Mongoose> | null }} Cache */

/** @type {typeof globalThis & { mongooseCache?: Cache }} */
const globalWithMongoose = globalThis;
const cache = globalWithMongoose.mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.mongooseCache = cache;

/** @param {string | undefined} uri */
export async function connectMongoose(uri) {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (cache.conn) return cache.conn;

  // Keep index creation explicit so legacy data is checked before unique indexes are built.
  cache.promise ??= mongoose.connect(uri, {
    bufferCommands: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  }).catch((error) => {
    cache.promise = null;
    throw error;
  });
  cache.conn = await cache.promise;
  return cache.conn;
}
