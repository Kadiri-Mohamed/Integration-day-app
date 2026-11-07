# YouPulse redevelopment roadmap

The roadmap follows the audit findings and preserves the existing Mongoose collections, public page, team-generation service, and match/clue service. It intentionally keeps unresolved BDE policy decisions configurable rather than inventing rules.

## Gate 0 — Secure configuration and baseline (P0)

**Work**

- Rotate the Atlas credential and any reused bootstrap password exposed in the prior README worktree version; keep `.env.local` out of Git and replace the placeholder `AUTH_SECRET` with a cryptographically random secret.
- Confirm Atlas replica-set/transaction support and least-privilege DB user. Verify a read-only connection outside production data first.
- Add environment validation and remove credentials from documentation/history if any were committed.
- Make deployment establish required indexes explicitly and plan migration/rollback before data mutation.

**Acceptance**: no secrets in tracked files or reachable history; auth secret is non-placeholder; health check can connect to a test replica-set DB; lint/type/build and current tests pass.

## Gate 1 — Restore domain invariants (P0)

**Work**

- Add one transactional match service that validates match structure, active/frozen game policy, legal state transition, two distinct participants, and that every team is free before starting.
- Reserve both team IDs atomically so concurrent starts on separate matches cannot double-book either team.
- Commit match status and audit record in the same transaction; create an idempotency contract for retries.
- Add schema/index migration for unique normalized student duplicate keys and match assignment uniqueness. Do not delete/replace teams referenced by historical matches.
- Strengthen audit append-only behavior, require actor/reason where appropriate, and audit sensitive corrections.
- Add login rate limiting and role/session revocation or current-role revalidation.

**Acceptance**: Mongo replica-set integration tests race two starts for the same team and prove exactly one succeeds; frozen/inactive games cannot start; audit failure rolls back protected state changes; role matrix and rate-limit tests pass.

## Gate 2 — Participant/team operations (P1)

**Work**

- Make CSV import bounded, normalized, atomic with audit, and robust to BOM/quoted cells/invalid headings. Add pagination and manual edit/add flows.
- Improve the existing scoring algorithm with a seedable RNG, explicit score reporting, measured distribution penalty, and practical large-roster performance. Keep six as current default until organization confirms 5/7 rules.
- Add manual member exchange with lock/state validation and audit. Confirm lock+generation+future match creation share concurrency control.

**Acceptance**: deterministic fixture tests prove each TEAM student assigned once, SOLO never assigned, score does not regress after swaps, malformed imports fail without partial writes, and manual swaps cannot mutate locked/event-started teams without approved override.

## Gate 3 — Games, assignments, and rotation (P0/P1)

**Work**

- Build admin CRUD for competitive stations, frozen state and Game Master assignments; resolve `Game.masters` vs `StaffUser.assignedGames` through a migration.
- Ask BDE to approve team-count parity, bye/waiting, station capacity, and post-rotation board-game rules. Record these in event settings.
- Implement a versioned rotation planner. Preview its impact before changes; after event start, retain completed and ongoing matches and only alter future assignments.
- Add match creation and assignment APIs with unique team reservations, state validation, cancellation, corrections, and idempotency.

**Acceptance**: all teams receive each required active game exactly once under approved rules; no overlapping team matches; freeze/unfreeze changes are previewed/audited; completed/in-progress records are never silently rewritten.

## Gate 4 — Clue, reveal, and results (P1)

**Work**

- Build secure clue-template management and validation of sufficient clues per planned match.
- Keep clue content out of every pre-reveal public/GM DTO; require admin role for protected management. Add admin correction with reason and immutable audit.
- Implement reveal-readiness service: all required matches done, all rotations complete, and no unresolved results; support a confirmed, reasoned, audited override.
- Add final-answer capture/procedure and official winner record; defer tie-break policy to BDE.

**Acceptance**: transaction tests prove one clue per winning match under duplicate/concurrent end requests; API tests prove no unrevealed clue content leaks; reveal is blocked until ready unless audited override is used.

## Gate 5 — Operational UI (P1)

**Work**

- Expand admin console for teams, games, matches, rotation, Game Masters, clues, reveal, audit, event settings, search, filters, sorting, and pagination.
- Simplify mobile Game Master flow with assigned-only queue, large start/end controls, confirmation, connectivity indicators, and retry-safe states.
- Add public team list/details/QR, progress and next assignment, and separate SOLO recreational-board view.
- Add explicitly configured board activity types; do not invent their rules.

**Acceptance**: Playwright covers admin setup, GM assigned/unassigned access, match run/result, clue count, reveal, and public no-auth pages at desktop/mobile viewports.

## Gate 6 — Readiness and deployment (P1/P2)

**Work**

- Bound/cache public queries, use safe DTOs and pagination, and load-test expected simultaneous viewers/writers.
- Add operational runbook, Atlas backups/restore drill, observability/alerts, Vercel environment checklist, error boundaries, and data export/recovery.
- Review accessibility, security, Mongo indexes, and all dependency advisories. Resolve the remaining moderate development-toolchain audit findings without downgrading the Next.js ESLint config.

**Acceptance**: clean install, CI tests, production build, security tests, load test, and restore drill all pass; event start is blocked until required setup completeness is confirmed.

## BDE decisions required before rotation implementation

1. How should team counts that produce 5 or 7 players be handled?
2. What is the odd-team bye/waiting policy, and does a bye count as completing a station?
3. How many simultaneous matches can a station host per round?
4. When do teams transfer to board activities, and which activities are competitive vs recreational?
5. What is the final-answer capture/tie procedure, and who can declare the official winner?

