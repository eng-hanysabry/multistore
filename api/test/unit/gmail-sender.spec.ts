import {
  classifyGoogleError,
  GmailApiMailSender,
  GmailTransport,
} from '../../src/modules/mail/infrastructure/gmail-api-mail-sender';
import {
  MailDailyLimitError,
  MailPermanentAuthError,
  MailTransientError,
} from '../../src/modules/mail/domain/mail-sender';
import { buildRawMessage } from '../../src/modules/mail/infrastructure/rfc822';

const decode = (raw: string): string => Buffer.from(raw, 'base64url').toString('utf8');

describe('buildRawMessage', () => {
  it('builds a UTF-8 base64 plain-text message', () => {
    const mime = decode(
      buildRawMessage('mailer@example.com', { to: 'a@b.co', subject: 'رمز', text: 'Code 1' }),
    );
    expect(mime).toContain('From: mailer@example.com');
    expect(mime).toContain('To: a@b.co');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('رمز').toString('base64')}?=`);
    const body = mime.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Code 1');
  });
  it('rejects header injection', () => {
    expect(() =>
      buildRawMessage('m@x.co', { to: 'a@b.co\r\nBcc: x@y.z', subject: 's', text: 't' }),
    ).toThrow();
    expect(() =>
      buildRawMessage('m@x.co', { to: 'a@b.co', subject: 's\nX: y', text: 't' }),
    ).toThrow();
  });
});

describe('classifyGoogleError', () => {
  it('invalid_grant and 401 are permanent', () => {
    expect(
      classifyGoogleError({ response: { status: 400, data: { error: 'invalid_grant' } } }),
    ).toBeInstanceOf(MailPermanentAuthError);
    expect(classifyGoogleError({ code: 401 })).toBeInstanceOf(MailPermanentAuthError);
    expect(
      classifyGoogleError(new Error('invalid_grant: Token has been expired or revoked')),
    ).toBeInstanceOf(MailPermanentAuthError);
  });
  it('the daily limit is its own case', () => {
    expect(
      classifyGoogleError({
        response: { status: 403, data: { error: { errors: [{ reason: 'dailyLimitExceeded' }] } } },
      }),
    ).toBeInstanceOf(MailDailyLimitError);
  });
  it('429, 5xx and network errors are transient', () => {
    expect(classifyGoogleError({ response: { status: 429 } })).toBeInstanceOf(MailTransientError);
    expect(classifyGoogleError({ code: 503 })).toBeInstanceOf(MailTransientError);
    expect(classifyGoogleError(new Error('ETIMEDOUT'))).toBeInstanceOf(MailTransientError);
    expect(classifyGoogleError(undefined)).toBeInstanceOf(MailTransientError);
  });
});

describe('GmailApiMailSender', () => {
  it('sends a raw message and maps failures', async () => {
    const calls: string[] = [];
    const st: { fail?: unknown } = {};
    const transport: GmailTransport = {
      sendRaw: (raw) => (st.fail ? Promise.reject(st.fail) : (calls.push(raw), Promise.resolve())),
      refreshAccessToken: () => (st.fail ? Promise.reject(st.fail) : Promise.resolve()),
    };
    const s = new GmailApiMailSender(transport, 'mailer@example.com');
    await s.send({ to: 'a@b.co', subject: 's', text: 't' });
    await s.checkAuth();
    expect(calls).toHaveLength(1);
    st.fail = { code: 401 };
    await expect(s.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toBeInstanceOf(
      MailPermanentAuthError,
    );
    await expect(s.checkAuth()).rejects.toBeInstanceOf(MailPermanentAuthError);
  });
});
