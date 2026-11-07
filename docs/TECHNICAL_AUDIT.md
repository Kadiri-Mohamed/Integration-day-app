# YouPulse technical audit

**Audit date:** 2026-11-06  
**Repository:** `https://github.com/Kadiri-Mohamed/Integration-day-app` (the checked-out `origin` matches this URL)  
**Scope:** Current worktree source, configuration, tests, scripts, and documentation. This is a static code audit plus local toolchain verification. No live MongoDB connectivity or mutation test was performed.

## Executive assessment

The repository is a runnable Next.js foundation, not yet an event-operable platform. It has a credentials sign-in path, an admin CSV/team setup slice, a public overview, and code for starting/completing a match. Most required administration and event scheduling features have no implementation. Match and clue behavior has not been integration-tested against MongoDB.

The highest-risk findings are:

1. **P0 — A database URI and weak bootstrap password were present in an uncommitted README worktree change.** I replaced them with placeholders in `README.md`. Rotate the database user credential and any account password that reused the exposed value. The configured `.env.local` is gitignored, but I did not test its connection. Its `AUTH_SECRET` value is still a placeholder and must be replaced before use beyond local development.
2. **P0 — Concurrent matches for one team are not prevented.** `startMatch` atomically transitions one match, but does not check or reserve the participating teams against other in-progress matches.
3. **P1 — A frozen game's pending match can still be started and completed.** Frozen state is displayed in the staff UI but is not enforced by the match operations.
4. **P1 — The public overview serializes raw match documents.** Clue contents are not currently returned, but internal match fields—including a future/non-null `idempotencyKey`—are not excluded.
5. **P1 — The event cannot be fully configured through the application.** There are no endpoints/UI for creating matches or clue templates, assigning Game Masters, operating rotations, correcting results, or triggering final reveal. The seed script only creates the nine game records.

## Scope and evidence standard

Repository inventory found the app routes under `app/`, Mongoose and business logic under `lib/`, two bootstrap/seed scripts under `scripts/`, and one Vitest file. There are no additional server-action modules, migration files, or route groups beyond those listed in [FEATURE_MATRIX.md](./FEATURE_MATRIX.md). The present `.env.local` has a Mongo URI configured and a placeholder auth secret; values are intentionally not reproduced here. Mongo connectivity and account existence were not probed.

“Verified” below means a local automated check or direct source inspection. Passing lint/build does not prove database state transitions, authentication, or security behavior at runtime.

## Findings

### P0 — Credentials were present in README worktree change; rotate them

The prior uncommitted `README.md` change contained a MongoDB connection credential and a weak bootstrap password in the setup snippet. I replaced those values with placeholders and preserved the bootstrap script. Rotate the Atlas database user secret and invalidate any account using the exposed password. Confirm the credential is absent from remote history and logs before publishing the branch. The `.env*` ignore rule in `.gitignore` excludes the local environment file from normal Git adds; it does not protect credentials committed in source or documentation.

### P0 — A team can start multiple matches simultaneously

`lib/permissions.ts` uses a compare-and-set on the selected `Match.status` only. Two different pending matches involving the same team can both transition to `IN_PROGRESS`. The match indexes in `lib/models.ts` are scoped to game/round/team tuple; they do not enforce one active match per team. This violates the event rule and can corrupt rotation progress. Add a transaction-backed reservation/guard for all participating team IDs and test simultaneous starts across different matches.

### P1 — Frozen state is display-only

`app/staff/page.tsx` shows a frozen badge but renders the same Start action for pending matches. `startMatch` and `endMatch` do not reject inactive/frozen games. There is no freeze/unfreeze API, impact preview, or post-start future-assignment policy. A frozen game's match can therefore still run and its clue template can still be consumed.

### P1 — Match start and its audit entry are not atomic

`startMatch` updates the match and then creates an audit record in a separate operation. If audit insertion fails, the committed match transition has no corresponding audit event. Match completion does put the result, clue consumption, clue creation, and audit insertion into one Mongo transaction. Apply equivalent transactional handling to start and other sensitive writes. `teams/lock` and participant import also write primary data before a separate audit insert.

### P1 — No invariant enforces exactly two distinct teams per match

`MatchSchema.teams` is a generic ObjectId array with no length/distinctness validation; `winner` is only checked by `endMatch` against membership in that array. Match creation is not exposed in this app, so malformed records can still be inserted directly or through future code. Add validation and a proper match-assignment creation transaction before event use.

### P1 — Public overview returns unprojected match objects

`app/api/public/overview/route.ts` calls `Match.find().populate(...).lean()` without selecting a public response shape, then returns the raw `matches` array. The current model has an `idempotencyKey` field and internal timestamps/IDs; the API would expose them when set. Clue records are correctly read only as team/count aggregates in this route, and clue content is not returned by this endpoint. Still replace the raw result with a narrow public DTO and add a serialization regression test.

### P1 — Clue storage exists; clue management/reveal does not

`endMatch` atomically consumes one unused `ClueTemplate` for the match’s game and inserts one `Clue` per winning match. A unique `Clue.match` index helps prevent duplicates, and the transaction requires a MongoDB replica set (Atlas supports this). There is no UI/API to create or review templates, reveal clues, correct an award, or gate reveal on all rotations/results. Match completion fails when no unused template exists; there is no configured clue pool in this repository. No integration test verifies rollback, retries, concurrent winners, or pre-reveal confidentiality.

### P1 — Staff and game assignment are only partially managed

The app authorizes Game Masters through `Game.masters` in `lib/permissions.ts` and filters the dashboard through that same field in `app/staff/page.tsx`. `StaffUser.assignedGames` is a second, unused assignment representation in `lib/models.ts`. There is no assignment-management UI/API, staff CRUD, password reset, or role management. The dashboard has no match polling or failure/connection state. It is not the complete administrator or mobile Game Master workflow from the brief.

### P1 — CSV import and team operations have consistency gaps

- `app/api/admin/participants/route.ts` checks duplicates before `insertMany`, while its unique index is case-sensitive. Two concurrent imports can pass the case-insensitive precheck with different casing. Normalize a duplicate key and enforce a unique index on it.
- Student insertion and the import audit record are separate writes. Audit failure can report an error after students were already inserted.
- Participant retrieval is unpaginated. Import caps JSON row count at 1,000 but has no explicit request byte limit or rate limit.
- Team lock updates the teams before writing the audit record. It also only checks for a match before the update, without a common transaction/lock with future match creation.
- Team regeneration does use a transaction and rejects locked teams or existing matches, which protects the implemented reset path.

### P1 — Authorization coverage is narrow, and role claims stay in the JWT

Server-side role checks are implemented for participant and team endpoints and in match operations. Game Masters are checked against their game's `masters` list. The admin pages have a server-side role redirect. However, only a small subset of routes exists, there is no rate limiting on credentials sign-in, and the role is copied into an eight-hour JWT. Removing/downgrading a staff account does not invalidate an already issued token immediately. Add session revocation/shorter role revalidation and auth throttling before production.

### P2 — Team balancing is a heuristic with narrow verification

`lib/team-generation.ts` filters SOLO participants, greedily fills six-person buckets using year/class/gender frequency penalties, then tries random cross-team swaps that improve a squared-count score. Tests verify fixed-size output, uniqueness, SOLO exclusion, and rejection of a non-multiple of six. They do **not** verify balancing quality or an objective score.

Specific limits:

- All team counts must divide evenly by six. Five/seven-player teams and byes remain unconfigured, as required by the BDE constraint.
- The result is stochastic (`Math.random` is used for shuffle, tie-breaking, and swaps), so regeneration does not reproduce a prior result and the algorithm cannot be seeded for audit/replay.
- Frequency sorting recomputes a roster-wide count inside the sort comparator, making the work roughly quadratic/log-linear at larger intake sizes.
- Utility callers can supply an invalid `targetSize` or iteration count; the API happens to constrain target size to six.
- No test quantifies balance across years, classes, or genders, tests skew/impossible distributions, or confirms the swap step never worsens its score.

Keep the balancing weights, seed, target sizes, and score report in a pure tested module; store the generated composition and score in the audit event.

### P2 — Public progress and display have inconsistent semantics

The overview query calculates `total` from all matches for each team, including cancelled matches, while `progress` counts `DONE`. Its game list includes frozen competitive games, but `stats.games` counts only active, non-frozen competitive games. The homepage header says “Live event” regardless of event configuration, and its “Nine games” title is static. Clarify the public event state and define denominator/rotation semantics before publishing standings.

### P2 — Client submission failure handling is incomplete

`app/staff/MatchEndForm.tsx` does not catch a rejected `fetch`; on network failure the form can remain busy and show no explanation. It has no confirmation step. CSV import/generate/lock handlers in `ParticipantTools.tsx` similarly lack a `try/finally`, so network failures can leave controls disabled. Add retry-safe UI, clear pending states, and confirmation for irreversible match/team operations.

### P2 — Audit immutability middleware is incomplete

`AuditSchema` blocks `findOneAndDelete` and `deleteMany` only. It does not block other mutation paths such as `deleteOne`, update operations, replacement, or direct collection calls. Audit entries also allow a null actor and do not enforce a reason for overrides. Current app routes only create audit records, but the schema does not provide the requested immutability guarantee.

### P2 — Architecture is compact but not ready for broader maintenance

`lib/models.ts`, route handlers, and staff pages compress most logic into long one-line definitions. The two scripts repeat partial Mongoose schemas rather than importing shared model definitions, creating drift risk. The repo installs `react-hook-form` and `@hookform/resolvers` but the current forms do not use them; there are no shadcn/ui components/dependency, no environment validation module, no migration strategy, and no reusable admin table/form components. Split model/validation/service/DTO code before the missing modules multiply.

## Public-data exposure assessment

| Data | Current finding |
|---|---|
| Clue contents | Not selected from `Clue` by the public overview. Current public route only aggregates clue counts. No broader reveal API exists. |
| Student names / roster | Not returned by current public API. No public team detail route exists. |
| Match data | Raw match documents are returned, including IDs/timestamps and potentially the `idempotencyKey`. Restrict fields. |
| Staff/password data | Not queried by public overview. Password hashes are not selected from staff APIs because none exists. |
| DB/auth secrets | `.env.local` is ignored, but a prior README worktree edit exposed credentials and was redacted. Rotate those secrets. |

## Verification results

Commands run against the current worktree:

- `npm test` — passed: 1 file, 3 team-generation tests.
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed; Next reported the expected public, admin, auth, match, and staff routes.
- `npm audit --omit=dev --audit-level=moderate` — passed, 0 production vulnerabilities.
- Full `npm audit --audit-level=critical` — no critical findings, but reports 8 moderate findings in the ESLint/TypeScript parser dependency chain (`minimatch`); npm's suggested forced fix downgrades `eslint-config-next`, so it was not applied.

No MongoDB connection, account, transaction, request authorization, or browser flow was exercised. Although `.env.local` is present and has a non-placeholder Mongo URI, its configured `AUTH_SECRET` is a placeholder. Replace that value and test against a non-production replica-set database before claiming runtime verification.

## Preservation note

No product modules were deleted or replaced during the audit. The README setup values were sanitized because the prior uncommitted worktree version contained credentials. The current README again uses placeholders; secret rotation is still required.
