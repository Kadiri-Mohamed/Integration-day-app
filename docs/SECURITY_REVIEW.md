# Production hardening security review

## Checks performed

- Staff mutations use same-origin checks and server-side role checks; `requireStaff` reloads active role and session version from MongoDB. Auth.js credentials use bcrypt, an eight-hour JWT session lifetime, and a database-backed per-email login attempt window.
- Match operations validate staff role and Game Master assignment on the server, use compare-and-set state changes, transition keys, partial unique team-in-match indexes, transactions, and audit writes.
- Participant input and admin mutations use Zod. Mongo query input derived from user search is escaped in reviewed paths. Public overview uses explicit projections and does not return awarded clue text.
- CSV report values are quoted and formula-prefixed cells are escaped. Audit snapshots are recursively stripped of credential-shaped keys before display/export.
- Production config now validates Mongo URI, generated secret length, and HTTPS Auth URL. `/api/health` pings MongoDB and returns a generic 503 on failure. Security response headers are configured in `next.config.ts`.
- `npm audit` is clean after pinning the affected parser transitive `minimatch` dependency to a patched release.

## Remaining verification / limitations

- Automated testing is currently unit/domain heavy. The optional MongoDB integration tests and Playwright role journeys require a dedicated disposable replica-set database and separate test accounts; they are skipped or not configured without those secrets. Do not point test variables at production.
- The MongoDB audit schema blocks normal Mongoose update/delete methods, but this is not a database-level append-only boundary. Production database credentials can still mutate or delete audit history; use restricted operational access and Atlas auditing/backup controls.
- Rate limiting is stored in MongoDB, keyed by normalized email or authenticated actor/operation. It is shared across app instances, but login throttling is not IP/device based and should be monitored for distributed abuse/denial-of-service.
- No external penetration test, dependency code review, load test, or browser-based accessibility audit was run. No custom Content Security Policy is enabled; verify the Next.js/Auth.js deployment requirements before adding one, because an incorrect policy can break runtime scripts.
- Verify cookie flags, reverse-proxy HTTPS forwarding, session invalidation, and CSRF behavior in the actual deployment environment. Mutation routes reject missing/cross-origin Origin values; browser journeys remain to be run.
- Ensure production secrets and any previously exposed credentials are rotated. This change does not inspect remote Git history or rotate Atlas/Auth.js credentials.

## Security gates

Run `npm audit`, `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run build`, and (with a disposable replica-set database and test credentials) `npm run test:integration` and `npm run test:e2e`. Review public API response fixtures and role-denial assertions whenever those contracts change.
