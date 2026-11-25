/**
 * One-time operator script (spec 9.1.1 rule 6): run on the operator's own computer.
 *   GOOGLE_CLIENT_JSON=./client_secret.json GMAIL_ALLOWED_ACCOUNT=mailer@gmail.com \
 *     [GMAIL_ACCOUNT_SUB=<pinned sub>] npm run gmail:authorize
 * Prints the consent URL, waits for Google on a loopback address, enforces the allowlist, and writes
 * the refresh token to ./gmail-refresh-token.txt (mode 0600). The token is never printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { GmailAuthorization } from '../src/modules/gmail-oauth/application/gmail-authorization';
import { GoogleOAuthAdapter } from '../src/modules/gmail-oauth/infrastructure/google-oauth-adapter';
import { SafeLogger } from '../src/common/logging/safe-logger';

const OUT_FILE = 'gmail-refresh-token.txt';

function credentials(): { id: string; secret: string } {
  const file = process.env['GOOGLE_CLIENT_JSON'];
  if (file) {
    const j = JSON.parse(readFileSync(file, 'utf8')) as {
      installed?: { client_id?: string; client_secret?: string };
    };
    if (j.installed?.client_id && j.installed.client_secret) {
      return { id: j.installed.client_id, secret: j.installed.client_secret };
    }
    throw new Error('GOOGLE_CLIENT_JSON must be a Desktop app client file ("installed")');
  }
  const id = process.env['GMAIL_CLIENT_ID'];
  const secret = process.env['GMAIL_CLIENT_SECRET'];
  if (!id || !secret)
    throw new Error('Set GOOGLE_CLIENT_JSON, or GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET');
  return { id, secret };
}

async function main(): Promise<void> {
  const allowed = process.env['GMAIL_ALLOWED_ACCOUNT'];
  if (!allowed) throw new Error('GMAIL_ALLOWED_ACCOUNT is required');
  const c = credentials();
  const pinned = process.env['GMAIL_ACCOUNT_SUB'];
  const log = new SafeLogger();
  let result: { sub: string } | undefined;

  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const auth = new GmailAuthorization(
    new GoogleOAuthAdapter(c.id, c.secret),
    {
      store: (t) => {
        writeFileSync(OUT_FILE, t.refreshToken, { mode: 0o600 });
        result = { sub: t.sub };
        return Promise.resolve();
      },
    },
    { allowedAccount: allowed, ...(pinned ? { pinnedSub: pinned } : {}), redirectUri },
    log,
  );
  const { url } = auth.begin();
  console.log('Open this address in a browser signed in as the dedicated Gmail account:\n');
  console.log(url);

  await new Promise<void>((resolve) => {
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirectUri);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      void auth
        .handleCallback({
          code: u.searchParams.get('code') ?? undefined,
          state: u.searchParams.get('state') ?? undefined,
          error: u.searchParams.get('error') ?? undefined,
        })
        .then((o) => {
          res.writeHead(o.ok ? 200 : 400, { 'content-type': 'text/plain' });
          res.end(o.ok ? 'Done. You can close this tab.' : 'Rejected. See the terminal.');
          console.log(
            o.ok
              ? `Accepted. Token saved to ${OUT_FILE}.`
              : `Rejected (${o.reason}). Nothing was stored.`,
          );
          if (o.ok) resolve();
        });
    });
  });
  server.close();
  if (result) console.log(`Google account id (sub, not a secret): ${result.sub}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exit(1);
});
