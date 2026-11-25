import { OAuth2Client } from 'google-auth-library';
import { gmail_v1 } from 'googleapis/build/src/apis/gmail/v1';
import { GmailTransport } from './gmail-api-mail-sender';

const GMAIL_CALL_TIMEOUT_MS = 10_000; // 10.7: Gmail API call timeout, no retry inside the request path

export interface GmailCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export function createGoogleGmailTransport(c: GmailCredentials): GmailTransport {
  const auth = new OAuth2Client(c.clientId, c.clientSecret);
  auth.setCredentials({ refresh_token: c.refreshToken });
  const gmail = new gmail_v1.Gmail({ auth });
  return {
    async sendRaw(raw: string): Promise<void> {
      await gmail.users.messages.send(
        { userId: 'me', requestBody: { raw } },
        { timeout: GMAIL_CALL_TIMEOUT_MS },
      );
    },
    async refreshAccessToken(): Promise<void> {
      await auth.refreshAccessToken();
    },
  };
}
