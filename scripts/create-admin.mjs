import mongoose from "mongoose";
import { hash } from "bcryptjs";
import { connectMongoose } from "../lib/mongoose-connection.mjs";
import { staffUserSchema } from "../lib/staff-user-schema.mjs";
import {
  AdminBootstrapInputError,
  initializeAdmin,
  readAdminBootstrapConfig,
} from "./admin-bootstrap.mjs";

try {
  const config = readAdminBootstrapConfig();
  await connectMongoose(config.mongoUri);
  const Staff = mongoose.models.StaffUser || mongoose.model("StaffUser", staffUserSchema);
  const result = await initializeAdmin({ StaffUser: Staff, config, hashPassword: hash });
  console.log(result.created
    ? "Initial SUPER_ADMIN account created."
    : "A staff account with the configured admin email already exists; no changes were made.");
} catch (error) {
  if (error instanceof AdminBootstrapInputError) {
    console.error(error.message);
  } else {
    console.error("Admin bootstrap failed. Verify the target MongoDB and its access configuration; no credentials were logged.");
  }
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
