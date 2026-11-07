import mongoose from "mongoose";
import { hash } from "bcryptjs";

const { MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!MONGODB_URI || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Set MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD first.");
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 14) {
  console.error("ADMIN_PASSWORD must be at least 14 characters.");
  process.exit(1);
}

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["SUPER_ADMIN", "ADMIN", "GAME_MASTER"], default: "ADMIN" },
  active: { type: Boolean, default: true },
}, { timestamps: true });

try {
  await mongoose.connect(MONGODB_URI, { autoIndex: false, bufferCommands: false });
  const Staff = mongoose.models.StaffUser || mongoose.model("StaffUser", staffSchema);
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (await Staff.exists({ email })) throw new Error("A staff account with that email already exists.");
  await Staff.create({ name: ADMIN_NAME.trim(), email, passwordHash: await hash(ADMIN_PASSWORD, 12), role: "SUPER_ADMIN" });
  console.log(`Created Super Admin account for ${email}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not create staff account.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
