import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI first.");
  process.exit(1);
}

const names = ["Code Names", "Toxic Waste", "Water Transfer", "Dancing Mannequins", "Sac Jump", "Spotting", "Flip 7", "Pull the Rope", "Spot the Bugs"];
const gameSchema = new mongoose.Schema({ name: { type: String, required: true, unique: true }, description: String, category: { type: String, enum: ["COMPETITIVE", "BOARD"], default: "COMPETITIVE" }, active: { type: Boolean, default: true }, frozen: { type: Boolean, default: false }, masters: [{ type: mongoose.Schema.Types.ObjectId, ref: "StaffUser" }] }, { timestamps: true });

try {
  await mongoose.connect(uri);
  const Game = mongoose.models.Game || mongoose.model("Game", gameSchema);
  for (const name of names) await Game.updateOne({ name }, { $setOnInsert: { name, category: "COMPETITIVE", active: true, frozen: false } }, { upsert: true });
  console.log(`Ensured ${names.length} competitive games exist.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not seed games.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
