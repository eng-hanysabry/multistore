# Deployment runbook (IP-3)

Spec: 9.1, 9.1.1, 10.3, 10.6, 10.7. Free tools only, no card.

## Host: Vercel Hobby (spec 10.6a), no card
The API is one Vercel Function from the `api/` folder (Root Directory `api`, region fra1, set in `api/vercel.json`). Render Free asked for a card, so `render.yaml` was removed.

## Environment (Vercel project, Production)
| Variable | Value |
|---|---|
| DATABASE_URL | `multistore_app` through the Supabase transaction pooler, with `?pgbouncer=true&connection_limit=3` |
| JWT_SECRET | random, 32+ characters |
| NODE_ENV | production |
| OUTBOX_MODE | `sweep` (no background loop on a serverless host) |
| CRON_SECRET | random, 32+ characters; the same value is the GitHub secret below |
| GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET | OAuth client of the dedicated account (Desktop app type) |
| GMAIL_REFRESH_TOKEN | from `npm run gmail:authorize` |
| GMAIL_ALLOWED_ACCOUNT | the dedicated Gmail address |
Gmail variables are all-or-none. Without them the API runs and `/health/ready` reports mail `DEGRADED: not_configured`.

## Scheduled retry (GitHub Actions)
`.github/workflows/outbox-sweep.yml` runs every 5 minutes (GitHub may delay it) and calls `POST $API_BASE_URL/internal/outbox/drain` with `Authorization: Bearer $CRON_SECRET`. Repository secrets: `API_BASE_URL` (the Vercel production URL, no trailing slash) and `CRON_SECRET`. Without them the job exits quietly.

## Migrations
Applied with the owner role, never by the API: `prisma/migrations/*/migration.sql` (psql or `prisma migrate deploy` with the owner URL on the session pooler or direct connection).

## One-time Gmail authorization (9.1.1)
1. Create a Desktop app OAuth client for the dedicated account. Download the client JSON.
2. On the operator's computer: `GOOGLE_CLIENT_JSON=./client_secret.json GMAIL_ALLOWED_ACCOUNT=<address> npm run gmail:authorize`.
3. Open the printed address signed in as the dedicated account. Continue past the "unverified app" notice (Path A).
4. The script accepts only the allowed account, rejects and revokes any other, writes `gmail-refresh-token.txt` (never printed), and prints the account `sub`.
Paste mode when the browser cannot reach the script: set `PASTE_FILE=/tmp/paste.txt`, run once to get the address, sign in, then save the full redirected address (it starts with `http://127.0.0.1:8765/callback`) in that file and run again.
5. Put the token in the Vercel variable `GMAIL_REFRESH_TOKEN`, delete the file, redeploy. The outbox drains by itself.

## Recovery from `invalid_grant` (9.1)
Mail shows `DEGRADED: auth_failed` in `/health/ready`. Pending mail stays in `email_outbox`. Repeat the authorization above, replace the variable, redeploy.

## Health
Vercel Hobby has no health-check path setting. `/health/live` (200 when the function answers) and `/health/ready` (503 when the database is down) are checked from outside. Readiness caches for 5 s.
