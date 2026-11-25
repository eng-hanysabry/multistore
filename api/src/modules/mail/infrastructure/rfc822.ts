import { MailMessage } from '../domain/mail-sender';

function assertHeaderSafe(name: string, value: string): void {
  // Header injection guard: no line breaks in anything that becomes a header.
  if (/[\r\n]/.test(value)) throw new Error(`${name} must not contain line breaks`);
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Builds the base64url RFC 822 message the Gmail API expects in `raw`. */
export function buildRawMessage(from: string, message: MailMessage): string {
  assertHeaderSafe('from', from);
  assertHeaderSafe('to', message.to);
  assertHeaderSafe('subject', message.subject);
  const body = (b64(message.text).match(/.{1,76}/g) ?? []).join('\r\n');
  const mime = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: =?UTF-8?B?${b64(message.subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}
