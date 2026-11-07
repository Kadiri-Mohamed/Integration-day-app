import { validateProductionEnvironment } from "@/lib/env";
import { connectMongoose } from "@/lib/mongoose-connection.mjs";

const uri = process.env.MONGODB_URI;

export async function connectDb() {
  validateProductionEnvironment();
  return connectMongoose(uri);
}
