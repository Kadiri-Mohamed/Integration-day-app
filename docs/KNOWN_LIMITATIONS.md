# YouPulse known limitations

This file records the limitations that prevent acceptance as production-ready. “Implemented” means source code exists; it does not imply that an event workflow passed integration or browser verification.

## Release blockers

- **Frozen/inactive station enforcement:** a pending match can be started after its game has been frozen/deactivated. See [match operations](../lib/permissions.ts). Resolve whether already assigned pending matches are canceled, reassigned, or require an explicit override, then implement and test that rule.
- **No MongoDB acceptance run:** `TEST_MONGODB_URI` was not configured, so all three [Mongo integration tests](../integration/domain.integration.test.ts) skipped. MongoDB replica-set transactions, indexes, unique constraint races, rollback, and clue selection are not verified.
- **No authenticated E2E role run:** the Playwright SUPER_ADMIN, ADMIN, and GAME_MASTER scenarios skipped for lack of dedicated accounts/fixtures. The public API test also skipped because the local database-backed endpoint returned unavailable. The only E2E success was the public homepage and sign-in-link smoke.
- **Event rules/data must be supplied:** the organizer must choose approved non-six team arrangements, odd-team/waiting behavior, station capacities, clue templates, actual SOLO activities, event timing/time zone, public roster/leaderboard privacy, and reveal content before schedule or event acceptance.
- **Recovery not proven:** backup and restore guidance exists, but no backup was restored and validated. No Atlas connectivity, failover, alerting, or production load test was run.

## Important incomplete verification

- CSV import/export has source validation but no API-level fixtures for malformed files/rows, duplicates under concurrent import, transaction rollback, byte limits, or comparison of displayed filters to downloaded records.
- Team preview, manual member changes, lock/unlock and schedule guard behavior have pure tests or source checks; their cross-collection transactions and concurrent operations have not been exercised against MongoDB.
- Rotation preview/validation/publication and freeze impact have substantial pure algorithm tests. Publication concurrency, stale settings, rollback, and restart/recovery require replica-set tests.
- Match start/end/cancel/correction and clue awards have source-level transaction patterns and helper tests, but duplicate concurrent requests, rollback, team reservation, clue inventory exhaustion, and actor scoping lack DB-backed tests. Specifically, match start does not currently enforce game active/frozen state.
- Board-game session and SOLO enrollment contain capacity reservation logic, but DB concurrency and lifecycle behavior are untested.
- Public team pages, QR PNG/bulk ZIP, hidden-member settings, 404 behavior, public API projections, and final-reveal privacy are not tested in a running seeded environment.
- Reports and audit export sanitize/quote values in unit tests, but filters, database aggregation accuracy, role denials, and real export/table equivalence have not been tested against fixture records.
- Mobile responsiveness, keyboard operation, screen-reader semantics, color contrast, and dialogs/tables have not received a manual or automated accessibility audit.
- No penetration test, XSS/IDOR fuzzing, request-body size abuse test, external security review, or production monitoring/logging review was performed. `npm audit` being clean only reports known npm advisories at that run.
- Audit append-only protection is application/Mongoose-level only; a database principal with write access can still modify the audit collection.
- `docs/FEATURE_MATRIX.md` is explicitly a Phase 0 snapshot and no longer accurately describes all modules present in the current tree. Use [the final acceptance report](./FINAL_ACCEPTANCE_REPORT.md) for current disposition.

## Gate to clear these limitations

1. Provision an isolated MongoDB replica set with a database name clearly marked for tests, and dedicated SUPER_ADMIN/ADMIN/GAME_MASTER accounts plus deterministic event fixtures.
2. Run `npm run test:integration` and all Playwright tests without skips; add database/API test cases for the uncovered critical workflows and role denials.
3. Fix and test frozen/inactive match start behavior; close any additional defects surfaced by the fixture run.
4. Obtain and enter organizer decisions and event-specific configuration; prove schedule validation and reveal readiness on that fixture.
5. Complete mobile/accessibility, security, load, backup restore, and deployment rehearsal. Record outcomes before changing final status.
