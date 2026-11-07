import type mongoose from "mongoose";
import { EventSettings } from "@/lib/models";

/** Serializes schedule validation/publication with edits to inputs it depends on. */
export async function touchScheduleGuard(session: mongoose.ClientSession) {
  await EventSettings.updateOne({ key: "event" }, { $inc: { scheduleVersion: 1 } }, { session });
}
