import mongoose from "mongoose";
import { normalizeIdentityKey } from "../lib/domain/identity.mjs";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required; migration was not run");
await mongoose.connect(uri, { autoIndex: false, bufferCommands: false });
const db = mongoose.connection.db;
const students = db.collection("students"), teams = db.collection("teams"), games = db.collection("games"), staff = db.collection("staffusers"), assignments = db.collection("gameassignments"), matches = db.collection("matches"), boardGames = db.collection("boardgames"), boardAssignments = db.collection("boardgameassignments"), soloActivities = db.collection("soloactivities"), soloParticipations = db.collection("soloparticipations");
const fail = (reason) => { throw new Error(`DOMAIN_MIGRATION_PREFLIGHT_FAILED:${reason}`); };
try {
  const clueTemplates = db.collection("cluetemplates");
  const [studentRows, teamRows, gameRows, staffRows, matchRows, clueRows, templateRows] = await Promise.all([students.find({}).toArray(), teams.find({}).toArray(), games.find({}).toArray(), staff.find({}).toArray(), matches.find({}).toArray(), db.collection("clues").find({}).toArray(), clueTemplates.find({}).toArray()]);
  const templateById = new Map(templateRows.map((row) => [String(row._id), row]));
  const teamById = new Map(teamRows.map((row) => [String(row._id), row]));
  const studentById = new Map(studentRows.map((row) => [String(row._id), row]));
  const teamNameKeys = new Set();
  for (const team of teamRows) {
    const nameKey = String(team.name).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    if (teamNameKeys.has(nameKey)) fail("normalized team names collide; rename duplicates before migrating");
    teamNameKeys.add(nameKey);
  }
  const staffIds = new Set(staffRows.map((row) => String(row._id))), gameIds = new Set(gameRows.map((row) => String(row._id)));
  const emails = new Set();
  for (const user of staffRows) { const email = String(user.email).trim().toLocaleLowerCase("en-US"); if (emails.has(email)) fail("normalized staff emails collide; resolve duplicates before migrating"); emails.add(email); }
  const identityKeys = new Set(), membershipByTeam = new Map(teamRows.map((row) => [String(row._id), new Set((row.members ?? []).map(String))]));
  const membershipByStudent = new Map();
  for (const team of teamRows) for (const memberId of team.members ?? []) if (!studentById.has(String(memberId))) fail("team references a missing participant");
  for (const student of studentRows) {
    const identityKey = normalizeIdentityKey(student);
    if (identityKeys.has(identityKey)) fail("normalized student identities collide; resolve duplicates before migrating");
    identityKeys.add(identityKey);
    const membership = student.team ? String(student.team) : null;
    const listedTeams = teamRows.filter((team) => (team.members ?? []).some((id) => String(id) === String(student._id)));
    if (student.mode === "SOLO" && (membership || listedTeams.length)) fail("SOLO participant is assigned to a team");
    if (membership && !teamById.has(membership)) fail("participant references a missing team");
    if (listedTeams.length > 1 || (membership && listedTeams.some((team) => String(team._id) !== membership))) fail("conflicting team membership links exist");
    const resolved = membership ?? (listedTeams[0] ? String(listedTeams[0]._id) : null);
    if (resolved) { membershipByStudent.set(String(student._id), resolved); membershipByTeam.get(resolved)?.add(String(student._id)); }
  }
  const linkDocs = new Map();
  for (const game of gameRows) for (const userId of game.masters ?? []) {
    if (!staffIds.has(String(userId))) fail("game assignment references missing staff");
    linkDocs.set(`${game._id}:${userId}`, { game: game._id, staffUser: new mongoose.Types.ObjectId(String(userId)), active: true, assignedAt: new Date() });
  }
  for (const user of staffRows) for (const gameId of user.assignedGames ?? []) {
    if (!gameIds.has(String(gameId))) fail("staff assignment references missing game");
    linkDocs.set(`${gameId}:${user._id}`, { game: new mongoose.Types.ObjectId(String(gameId)), staffUser: user._id, active: true, assignedAt: new Date() });
  }
  const inProgress = await matches.find({ status: "IN_PROGRESS" }, { projection: { teams: 1 } }).toArray();
  const activeTeamIds = new Set();
  for (const match of inProgress) for (const teamId of match.teams ?? []) {
    if (activeTeamIds.has(String(teamId))) fail("a team appears in multiple active matches");
    activeTeamIds.add(String(teamId));
  }
  const matchById = new Map(matchRows.map((row) => [String(row._id), row]));
  const clueMatches = new Set();
  for (const clue of clueRows) {
    const match = matchById.get(String(clue.match));
    if (!match || !(match.teams ?? []).some((teamId) => String(teamId) === String(clue.team))) fail("awarded clue references a missing match or a non-participating team");
    if (clueMatches.has(String(clue.match))) fail("multiple awarded clues reference the same match");
    clueMatches.add(String(clue.match));
    if (clue.sourceTemplate && (!templateById.has(String(clue.sourceTemplate)) || String(templateById.get(String(clue.sourceTemplate)).game) !== String(match.game))) fail("awarded clue references a missing template or a template from another game");
  }

  for (const student of studentRows) {
    const teamId = membershipByStudent.get(String(student._id)) ?? null;
    await students.updateOne({ _id: student._id }, { $set: { identityKey: normalizeIdentityKey(student), status: student.status ?? "ACTIVE", registration: student.registration ?? { source: "MIGRATION", registeredAt: student.createdAt ?? new Date(), registeredBy: null }, team: teamId ? new mongoose.Types.ObjectId(teamId) : null } });
  }
  for (const team of teamRows) await teams.updateOne({ _id: team._id }, { $set: { nameKey: String(team.name).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"), members: [...(membershipByTeam.get(String(team._id)) ?? [])].map((id) => new mongoose.Types.ObjectId(id)), status: team.status ?? "ACTIVE", locked: team.locked ?? false } });
  for (const user of staffRows) await staff.updateOne({ _id: user._id }, { $set: { email: String(user.email).trim().toLocaleLowerCase("en-US"), active: user.active ?? true, sessionVersion: user.sessionVersion ?? 0 } });
  await clueTemplates.createIndex({ legacyClue: 1 }, { unique: true, sparse: true, name: "legacy_clue_template_unique" });
  for (const clue of clueRows) {
    const match = matchById.get(String(clue.match));
    let templateId = clue.sourceTemplate;
    if (!templateId) {
      const exact = await clueTemplates.find({ game: match.game, content: clue.content, used: true }).limit(2).toArray();
      if (exact.length === 1) templateId = exact[0]._id;
      else {
        await clueTemplates.updateOne({ legacyClue: clue._id }, { $setOnInsert: { game: match.game, content: clue.content, active: false, used: true, reservedFor: match._id, legacyClue: clue._id, createdAt: clue.awardedAt ?? match.completedAt ?? new Date(), updatedAt: new Date() } }, { upsert: true });
        templateId = (await clueTemplates.findOne({ legacyClue: clue._id }, { projection: { _id: 1 } }))._id;
      }
    }
    await db.collection("clues").updateOne({ _id: clue._id }, { $set: { game: match.game, sourceTemplate: templateId, awardedAt: clue.awardedAt ?? match.completedAt ?? new Date() } });
    await matches.updateOne({ _id: match._id }, { $set: { awardedClue: clue._id } });
  }
  await clueTemplates.updateMany({ priority: { $exists: false } }, { $set: { priority: 100 } });
  await db.collection("clues").updateMany({ voidedAt: { $exists: false } }, { $set: { voidedAt: null, voidedBy: null, voidReason: null } });
  if (linkDocs.size) await assignments.bulkWrite([...linkDocs.values()].map((doc) => ({ updateOne: { filter: { game: doc.game, staffUser: doc.staffUser }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false });
  await games.updateMany({}, { $unset: { masters: "" } }); await staff.updateMany({}, { $unset: { assignedGames: "" } });

  const existingIndexes = await students.indexes();
  for (const index of existingIndexes) if (index.name === "fullName_1_className_1") await students.dropIndex(index.name);
  const rotationSlotCollection = db.collection("rotationslots");
  const rotationSlotIndexes = await rotationSlotCollection.indexes();
  for (const index of rotationSlotIndexes) if (index.name === "rotation_sequence_unique") await rotationSlotCollection.dropIndex(index.name);
  await rotationSlotCollection.updateMany({ stationKey: { $exists: false } }, { $set: { stationKey: "default", ordinal: 1 } });
  const rotationCollection = db.collection("rotations");
  const rotationRows = await rotationCollection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const claimedVersions = new Set(); let nextRotationVersion = 1;
  for (const rotation of rotationRows) {
    let version = Number(rotation.eventVersion);
    if (!Number.isInteger(version) || version < 1 || claimedVersions.has(version)) { while (claimedVersions.has(nextRotationVersion)) nextRotationVersion += 1; version = nextRotationVersion; }
    claimedVersions.add(version); nextRotationVersion = Math.max(nextRotationVersion, version + 1);
    if (rotation.eventVersion !== version) await rotationCollection.updateOne({ _id: rotation._id }, { $set: { eventVersion: version } });
  }
  await db.collection("eventsettings").updateMany({ schedulePolicy: { $exists: false } }, { $set: { schedulePolicy: { approved: false, oddTeamPolicy: "UNCONFIGURED", capacityOverflowPolicy: "UNCONFIGURED" } } });
  await db.collection("eventsettings").updateMany({ scheduleVersion: { $exists: false } }, { $set: { scheduleVersion: 0 } });
  await db.collection("eventsettings").updateMany({ revealStatus: { $exists: false } }, { $set: { revealStatus: "DRAFT", revealContent: "", revealedAt: null, revealedBy: null } });
  await boardGames.updateMany({ supervisors: { $exists: false } }, { $set: { supervisors: [] } });
  await soloActivities.updateMany({ rules: { $exists: false } }, { $set: { rules: "" } });
  await soloActivities.updateMany({ supervisors: { $exists: false } }, { $set: { supervisors: [] } });
  await soloActivities.updateMany({ available: { $exists: false } }, { $set: { available: true } });
  await soloActivities.updateMany({ awardsClues: { $exists: false } }, { $set: { awardsClues: false } });
  for (const activity of await soloActivities.find({ seatsTaken: { $exists: false } }, { projection: { _id: 1 } }).toArray()) {
    const seatsTaken = await soloParticipations.countDocuments({ activity: activity._id, status: { $ne: "WITHDRAWN" } });
    await soloActivities.updateOne({ _id: activity._id }, { $set: { seatsTaken } });
  }
  const boardAssignmentIndexes = await boardAssignments.indexes();
  for (const index of boardAssignmentIndexes) if (index.name === "boardGame_1_rotationSlot_1_team_1") await boardAssignments.dropIndex(index.name);
  await boardAssignments.updateMany({ session: { $exists: false } }, { $set: { session: null, student: null } });
  const clueIndexes = await db.collection("clues").indexes();
  for (const index of clueIndexes) if (index.name === "match_1") await db.collection("clues").dropIndex(index.name);
  await Promise.all([
    students.createIndex({ identityKey: 1 }, { unique: true, name: "student_identity_unique" }),
    students.createIndex({ team: 1, status: 1 }),
    teams.createIndex({ nameKey: 1 }, { unique: true, name: "team_name_unique" }), teams.createIndex({ slug: 1 }, { unique: true, name: "team_slug_unique" }),
    games.createIndex({ name: 1 }, { unique: true }),
    assignments.createIndex({ game: 1, staffUser: 1 }, { unique: true, name: "game_staff_assignment_unique" }),
    rotationCollection.createIndex({ eventVersion: 1 }, { unique: true, name: "rotation_event_version_unique" }),
    matches.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: "match_idempotency_unique" }),
    matches.createIndex({ teams: 1 }, { unique: true, partialFilterExpression: { status: "IN_PROGRESS" }, name: "active_team_match_unique" }),
    db.collection("clues").createIndex({ match: 1 }, { unique: true, partialFilterExpression: { voidedAt: null }, name: "one_active_clue_per_match" }),
    db.collection("clues").createIndex({ team: 1, awardedAt: 1 }),
    clueTemplates.createIndex({ game: 1, active: 1, used: 1, priority: 1 }, { name: "clue_inventory_priority" }),
    rotationSlotCollection.createIndex({ rotation: 1, sequence: 1, stationKey: 1, ordinal: 1 }, { unique: true, name: "rotation_station_ordinal_unique" }),
    db.collection("eventsettings").createIndex({ key: 1 }, { unique: true }),
    db.collection("eventannouncements").createIndex({ active: 1, startsAt: 1, endsAt: 1 }, { name: "public_announcement_window" }),
    staff.createIndex({ email: 1 }, { unique: true }),
    db.collection("boardgames").createIndex({ game: 1 }, { unique: true, sparse: true }),
    db.collection("boardgamesessions").createIndex({ boardGame: 1, startAt: 1 }),
    boardAssignments.createIndex({ boardGame: 1, rotationSlot: 1, team: 1 }, { unique: true, partialFilterExpression: { team: { $type: "objectId" } }, name: "board_team_assignment_unique" }),
    boardAssignments.createIndex({ session: 1, student: 1 }, { unique: true, partialFilterExpression: { student: { $type: "objectId" } }, name: "board_session_student_unique" }),
    db.collection("soloactivities").createIndex({ rotationSlot: 1, active: 1 }),
    db.collection("soloparticipations").createIndex({ activity: 1, student: 1 }, { unique: true }),
    db.collection("authattempts").createIndex({ key: 1 }, { unique: true }),
    db.collection("authattempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("adminguards").createIndex({ key: 1 }, { unique: true }),
  ]);
  console.log(`Domain migration complete: ${studentRows.length} participants, ${teamRows.length} teams, ${linkDocs.size} staff-game assignments.`);
} finally { await mongoose.disconnect(); }
