# YouPulse

YouPulse is a Next.js App Router application for running the BDE Day of Integration. The app uses MongoDB Atlas through Mongoose and keeps staff authentication and match operations on the server.

## Run locally

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set `MONGODB_URI` and `AUTH_SECRET`.
4. Run `npm run dev` and open `http://localhost:3000`.

The public home page is at `/`. Staff use `/staff/sign-in`.

## Staff account bootstrap

Create the first administrator using the one-time script:

```powershell
$env:MONGODB_URI="mongodb+srv://..."
$env:ADMIN_NAME="Event Administrator"
$env:ADMIN_EMAIL="admin@example.org"
$env:ADMIN_PASSWORD="use-a-long-unique-password"
node scripts/create-admin.mjs
```

The script refuses to replace an existing email. Store credentials in a password manager and rotate the bootstrap password after use.

Seed the nine required competitive games with `node scripts/seed-games.mjs` after setting `MONGODB_URI`.

## Current implementation

- Next.js App Router with TypeScript, Tailwind CSS, and Lucide.
- Mongoose models for students, teams, games, matches, staff, clue templates, awarded clues, and immutable audit records.
- Auth.js credentials sign-in with bcrypt password comparison, JWT sessions, and server-side role checks.
- Staff dashboard filters Game Master stations to assigned games.
- Atomic match start; match completion validates the winner, uses a MongoDB transaction, consumes a game clue template, awards one clue, and writes an audit record.
- Public overview API returns team clue counts and event progress without returning clue contents.
- Admin participant CSV import validates required fields and catches duplicate name/class combinations.
- Scoring-based team generation balances year, class, and gender distributions, excludes SOLO participants, and only creates teams of six. It refuses regeneration after locking or match creation.
- Admin participant setup page previews CSV rows, triggers team generation, and locks teams.
- `scripts/seed-games.mjs` upserts the nine required competitive game stations.
- `.env.example` documents the server-only MongoDB URI and auth secret.

## Event setup requirements

MongoDB transactions require a replica set (MongoDB Atlas provides this). Configure unused clue templates for each game before ending matches. Match completion reports a configuration error if that game has no clue available.

The organization has not specified exact parity/bye rules or how 5- and 7-person teams should be handled. These remain configuration decisions and are not silently inferred by the application.

## Remaining product work

The current repository is an initial working foundation, not a complete production deployment. Rotation planning and overrides, admin CRUD screens for the remaining event entities, public team detail/QR views, clue administration and final reveal workflow, board-game/solo management, rate limiting, and end-to-end/business-rule tests remain to be implemented. Configure a production MongoDB Atlas replica set and `AUTH_SECRET` before deployment; no credentials are committed.
