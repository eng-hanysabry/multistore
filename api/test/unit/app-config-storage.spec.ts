import { parseConfig } from '../../src/common/config/app-config';

/**
 * STORAGE_PROVIDER parsing (IP-5 Step 8, B6): explicit provider selection with a safe,
 * fast failure when Drive settings are incomplete. Added under the Step 8 authorization
 * allowance for tests directly required by the implementation.
 */

const BASE: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://multistore_app:pw@localhost:5432/postgres',
  JWT_SECRET: 'x'.repeat(32),
  OUTBOX_MODE: 'loop',
};

const DRIVE: Record<string, string> = {
  GOOGLE_DRIVE_FOLDER_ID: 'folder-1',
  GOOGLE_DRIVE_CLIENT_ID: 'id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
};

describe('parseConfig: storage provider selection', () => {
  it('defaults to the local double with no Drive config', () => {
    const cfg = parseConfig({ ...BASE });
    expect(cfg.storageProvider).toBe('local');
    expect(cfg.drive).toBeUndefined();
  });

  it('rejects an unknown provider value', () => {
    expect(() => parseConfig({ ...BASE, STORAGE_PROVIDER: 's3' })).toThrow(
      /STORAGE_PROVIDER must be local or drive/,
    );
  });

  it('drive requires every GOOGLE_DRIVE_* variable, named without values', () => {
    expect(() =>
      parseConfig({ ...BASE, STORAGE_PROVIDER: 'drive', GOOGLE_DRIVE_FOLDER_ID: 'folder-1' }),
    ).toThrow(
      /missing: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN/,
    );
    expect(() => parseConfig({ ...BASE, STORAGE_PROVIDER: 'drive' })).toThrow(
      /STORAGE_PROVIDER=drive requires/,
    );
  });

  it('drive with complete settings parses; the error path never echoes secret values', () => {
    const cfg = parseConfig({ ...BASE, ...DRIVE, STORAGE_PROVIDER: 'drive' });
    expect(cfg.storageProvider).toBe('drive');
    expect(cfg.drive?.folderId).toBe('folder-1');
    try {
      parseConfig({
        ...BASE,
        ...DRIVE,
        STORAGE_PROVIDER: 'drive',
        GOOGLE_DRIVE_REFRESH_TOKEN: '',
      });
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('GOOGLE_DRIVE_REFRESH_TOKEN');
      expect(message).not.toContain('secret');
    }
  });
});
