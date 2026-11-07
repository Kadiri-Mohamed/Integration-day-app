# YouPulse production deployment gate

**Current state: deployment is not approved.** This checklist describes the required path after the blockers in [known limitations](./KNOWN_LIMITATIONS.md) are cleared. Use [the longer production runbook](./PRODUCTION_RUNBOOK.md) for backup/restore and rollback details.

## Required infrastructure and configuration

- Node.js 20.9 or later; install locked dependencies with `npm ci`.
- MongoDB Atlas or another replica set that supports transactions. Use a dedicated least-privilege user, TLS, restricted network access, production database, automated snapshots, and point-in-time recovery if available.
- Configure server-side `MONGODB_URI`, generated `AUTH_SECRET` (at least 32 random characters), and canonical HTTPS `AUTH_URL`. Set `NEXT_PUBLIC_SITE_URL` only to the public site origin if canonical team QR URLs need it. Do not put credentials in any `NEXT_PUBLIC_*` variable or source file.
- Bootstrap `SUPER_ADMIN` once using the documented `ADMIN_NAME`, `ADMIN_EMAIL`, and unique `ADMIN_PASSWORD` values supplied through the provider’s secret manager. Remove those one-time values after creation. Create separate ADMIN and assigned GAME_MASTER accounts through the app.
- Keep `.env.local` and all deployment credentials out of version control. Rotate any previously exposed database or reused bootstrap password; this repository audit cannot rotate them or inspect remote Git history.

## Pre-deployment checklist

1. Obtain written event-owner decisions for team-size remainder policy, odd-team/byes/waiting, station capacities, board-game participation mode, the three actual SOLO activities, public member/leaderboard privacy, and final answer/tie procedure. Record values in event settings; do not infer them from code defaults.
2. Provision a **disposable** replica-set database and separate test accounts/fixtures. Run `npm run test:integration` and `npm run test:e2e`; require zero skipped tests. Exercise participant import, team generation/manual editing, schedule publish, station freeze, match result, clue award/correction, reveal, exports, and role denials.
3. Fix the known frozen/inactive game start gap and add regression tests before production. Resolve any additional defects from the test fixture run.
4. Pass `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm audit` in CI. The current local checks pass, but this alone does not clear steps 1–3.
5. Take a pre-migration backup and validate a restore in a separate database. Confirm the migration target URI through the provider’s job configuration; inspect preflight results before running `npm run migrate:domain`.
6. Run `npm run check:domain` against the verified staging database. Seed defaults only if needed with `node scripts/seed-games.mjs`; then configure station capacity, staff assignments, clues, activities, event schedule, and approved policies.
7. Verify `/api/health`, staff login/session revocation, public event/team routes, role-based admin operations, response headers, and audit data in staging. Complete a phone-sized viewport and accessibility review.
8. Load-test expected viewers and event writes; confirm monitoring/alerts, incident owner, backup schedule, restore steps, and rollback version are available to the event team.
9. Require an independent sign-off that no unapproved organizer rule remains and that no integration/E2E test is skipped. Then update [the final acceptance report](./FINAL_ACCEPTANCE_REPORT.md) with dated evidence and decision.

## Deploy and rollback

Deploy the tested commit through the provider’s production release process using the verified environment set. Run the health endpoint and event-day smoke checks before opening public traffic. Monitor application logs and database health; the endpoint intentionally returns generic database status only.

For application faults, roll back to the previous tested application version and its compatible environment configuration. Do not automatically reverse schema/data migrations. Stop writes and restore a verified backup only through the incident procedure in [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md), after preserving the current state and assessing lost event writes.

## Go/no-go

Until the final acceptance report is changed from **NOT READY** based on executed evidence, this checklist does not authorize production launch. Staging deployment is appropriate only with synthetic/test data and a disposable database.
