# YouPulse production runbook

## Environment and infrastructure

- Use Node.js 20.9 or newer and the lockfile (`npm ci`).
- Use MongoDB Atlas or another MongoDB replica set. Transactions are required for match completion, clue reservation, schedule publication, and several administrative writes. A standalone `mongod` is not sufficient.
- Use a dedicated least-privilege database user, a production database, TLS, network access rules limited to the app's egress, and a generated Auth.js secret of at least 32 characters.
- Set `MONGODB_URI`, `AUTH_SECRET`, and an HTTPS `AUTH_URL` in the deployment provider's encrypted server environment. Never set them as `NEXT_PUBLIC_*` values. `NEXT_PUBLIC_SITE_URL` may be set to the canonical public HTTPS origin for team QR codes.
- `.env.example` contains placeholders only. Production requests fail closed when required environment values are missing or still look like placeholders. Keep `.env.local` out of Git.

## Prepare and deploy

1. Create a new Atlas database and replica set; create a least-privilege app user and allow only the deployment network.
2. Configure the environment variables above in the deployment provider. Set `AUTH_URL` to the canonical HTTPS URL.
3. Run `npm ci`, `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm audit` in CI. Keep the successful commit and deployment identifier for rollback.
4. Take and verify a database backup before the first schema migration. Review the migration preflight output and resolve duplicate normalized identities or dangling references before proceeding.
5. Run `npm run migrate:domain` as a one-off job against the intended database. It is designed to be idempotent, but it changes data and indexes; confirm the URI and backup before execution.
6. Run `npm run check:domain`, then seed only missing default games with `node scripts/seed-games.mjs` if appropriate.
7. Create the initial SUPER_ADMIN through the one-time `scripts/create-admin.mjs` process with `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` supplied through a secret manager. Remove those bootstrap variables after the one-off job. Do not reuse an event participant or database password.
8. Configure approved event rules, stations/capacities, clue inventory, and activities. Confirm the organizer's odd-team/waiting policy and team-size policy. Validate and publish a draft schedule before operating matches.
9. Deploy the application, verify `/api/health`, sign in with the initial account, then create and test separate ADMIN and assigned GAME_MASTER accounts. Verify public pages and reports.
10. Monitor provider logs, Atlas metrics, `/api/health`, and audit activity during the event. Health responses intentionally do not contain database hosts, exception text, or secrets.

## Backup and restore

Enable scheduled Atlas snapshots and point-in-time recovery at a retention period approved by the event owner. Restrict restore access and periodically verify a restore into a separate database. A snapshot that has never been restored is not a verified recovery plan.

For an operator-managed archive, use a secret manager to provide the URI without writing it into shell history or source control, then run `mongodump --uri="$MONGODB_URI" --archive=youpulse-backup.archive.gz --gzip`. Store the encrypted archive outside the application host and record the timestamp and deployment version. Restore only into an isolated target first: `mongorestore --uri="$RESTORE_URI" --archive=youpulse-backup.archive.gz --gzip --drop`. Review the target URI carefully because `--drop` removes collections in that target database.

For a recovery event, stop event writes, preserve the current database snapshot for investigation, restore to a separate database, validate it with `npm run check:domain`, then switch the deployment URI through the provider's secret manager and redeploy. Obtain an operational decision before discarding writes made after the selected backup.

## Rollback

Application rollback: redeploy the previous known-good application version and restore its environment configuration. Do not automatically roll back database changes; this project has no general down-migration. The domain migration is intended to be repeatable, but schema/data rollback must use a verified pre-migration snapshot after assessing intervening writes. Keep application versions compatible with the current schema and rehearse recovery outside the event.

## Current release blockers / operator decisions

- No disposable replica-set URI or test staff accounts were available in the local environment, so database transactions, account journeys, and E2E flows were not run here.
- The organization still must approve team-size/remainder and odd-team/waiting policies, enter station capacities, and configure clue inventory and the actual SOLO activities before the corresponding event workflows can be validated.
- A successful local build is not evidence of Atlas networking, production secret configuration, backups, load capacity, or an operational restore.
