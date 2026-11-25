import { ConfigError, describeConfig, parseConfig } from '../../src/common/config/app-config';

const base = {
  DATABASE_URL: 'postgresql://multistore_app:pw@localhost:5432/db',
  JWT_SECRET: '0123456789012345678901234567890123456789',
};
const gmail = {
  GMAIL_CLIENT_ID: 'id',
  GMAIL_CLIENT_SECRET: 'client-secret-value',
  GMAIL_REFRESH_TOKEN: 'refresh-token-value',
  GMAIL_ALLOWED_ACCOUNT: ' Mailer@Gmail.com ',
};

describe('Gmail settings in typed config', () => {
  it('are optional: no Gmail variables means no gmail config', () => {
    expect(parseConfig(base).gmail).toBeUndefined();
  });
  it('load when all four are set', () => {
    expect(parseConfig({ ...base, ...gmail }).gmail).toMatchObject({ account: 'Mailer@Gmail.com' });
  });
  it('are all-or-none', () => {
    expect(() => parseConfig({ ...base, GMAIL_CLIENT_ID: 'id' })).toThrow(ConfigError);
  });
  it('require a valid allowed account address', () => {
    expect(() => parseConfig({ ...base, ...gmail, GMAIL_ALLOWED_ACCOUNT: 'nope' })).toThrow(
      /GMAIL_ALLOWED_ACCOUNT/,
    );
  });
  it('never put secrets or the address into the boot log description', () => {
    const text = JSON.stringify(describeConfig(parseConfig({ ...base, ...gmail })));
    expect(text).not.toContain('client-secret-value');
    expect(text).not.toContain('refresh-token-value');
    expect(text).not.toContain('Mailer');
  });
});
