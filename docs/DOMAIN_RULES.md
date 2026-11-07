# Domain rules and migration

## Participant identity

`identityKey` is a JSON tuple of normalized full name, year, and class. Names and classes use Unicode NFKC normalization, trim leading/trailing whitespace, collapse internal whitespace, and lowercase with the `en-US` locale. Year is uppercase. This makes `José Ben`, `Jose\u0301 Ben`, and spacing/case variations the same identity within the same year and class. A person with the same name in a different year or class is a separate identity. The canonical implementation is `lib/domain/identity.mjs`; participant imports and the migration both call it.

## Membership and progress

`Student.team` and `Team.members` are reciprocal links. All app writes that change membership should use `lib/domain/team-membership.ts` or the transactional team-generation route. SOLO participants must have a null team. Team clue count and match progress are derived from `Clue` and `Match`, not stored as mutable counters.

## Match lifecycle

Allowed state progression is PENDING → IN_PROGRESS → DONE. Cancellation is a separate ADMIN/SUPER_ADMIN operation requiring a reason and is allowed before completion. Start/end/cancel operations use a MongoDB transaction, compare-and-set status, a deterministic per-match transition key, and an audit record in the same transaction. A partial unique index prevents a team from appearing in two IN_PROGRESS matches.

## Rotation schedules

The planner in `lib/domain/scheduling.ts` assigns locked active teams to active, unfrozen competitive games. Each game needs a distinct station, configured positive `stationCapacity` (matches per rotation), and `teamsPerMatch`. It records waiting teams, prevents team double-bookings and repeated team/game pairs, respects existing published reservations, and returns conflicts instead of hiding infeasible assignments.

The event `schedulePolicy` must be explicitly approved and select an odd-team policy (`BLOCK`, `BYE`, or `WAITING`) and capacity-overflow policy (`BLOCK` or `WAITING`). Event date, an IANA time zone, start/end times, and station capacity are also required; missing values block validation/publication. A BYE is visible as a single waiting team only when the overall team count is odd; it does not excuse general capacity overflow.

Schedule state is `DRAFT` → `VALIDATED` → `PUBLISHED` → `IN_PROGRESS` → `COMPLETED`. Each save creates a new `eventVersion`. Draft slots are persisted without matches; publishing creates PENDING matches and changes schedule state in one MongoDB transaction. Draft exchanges are conflict-checked. Targeted regeneration changes only the selected draft rotation and preserves the others. Published schedules cannot be silently overwritten. Freezing a game records affected pending matches and alternatives in an audited, reasoned operation; existing match assignments are retained.

The domain migration replaces the old unique `(rotation, sequence)` slot index with `(rotation, sequence, stationKey, ordinal)` so one rotation can schedule multiple station matches concurrently. `Game.stationCapacity` intentionally remains unset on existing games; administrators must configure it rather than inheriting an assumed capacity.

## Game Master assignment

`GameAssignment` is canonical. The migration unions legacy `Game.masters` and `StaffUser.assignedGames`, rejects dangling references, and removes the duplicated arrays only after writing the canonical links.

## Migration and checks

`npm run migrate:domain` is idempotent and performs preflight checks before backfilling participant identity/status/registration, reciprocal team membership, clue provenance, and Game Master assignments. It then creates the unique and supporting indexes. It deliberately refuses normalized identity collisions or conflicting references; resolve those records first, then rerun. The migration writes to MongoDB, so review `MONGODB_URI` and take a backup before invoking it.

`npm run check:domain` reports reciprocal membership errors, SOLO assignments, overlapping active matches, and dangling staff-game assignments. Unit tests cover pure identity/validation behavior and Mongoose document constraints; MongoDB replica-set behavior still needs verification against a disposable integration database.
