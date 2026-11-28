import { StorageError } from '../../src/modules/media/domain/storage-errors';
import { mapDriveError } from '../../src/modules/media/infrastructure/drive-error-mapper';
import {
  createDriveFilesClient,
  DriveFileMeta,
  DriveFilesClient,
  DriveStorageProvider,
} from '../../src/modules/media/infrastructure/drive-storage-provider';
import { storageProviderContract } from '../contract/storage-provider.contract';

/**
 * Drive adapter tests (IP-5 Step 8, authorization B7/B8). Everything runs against an
 * injected fake Drive client: this spec imports no googleapis client factory path into
 * any storage operation, performs no OAuth flow and opens no network connection; the
 * single factory test below only constructs objects (constructors are offline).
 */

interface FakeFile {
  id: string;
  name: string;
  key: string;
  parent: string;
  mimeType: string;
  bytes: Uint8Array;
  trashed: boolean;
}

const APP_FOLDER = 'app-folder';

/** In-memory fake of the public Drive v3 files surface. Error injection is one-shot. */
class FakeDriveFilesClient implements DriveFilesClient {
  readonly files = new Map<string, FakeFile>();
  nextError: unknown;
  private seq = 0;

  private gate(): void {
    if (this.nextError !== undefined) {
      const err = this.nextError;
      this.nextError = undefined;
      throw err;
    }
  }

  list(params: {
    q: string;
    pageSize?: number;
    fields?: string;
    spaces?: string;
  }): Promise<{ data: { files?: DriveFileMeta[] | null } }> {
    this.gate();
    const key = /value='([^']+)'/.exec(params.q)?.[1];
    const parent = /'([^']+)' in parents/.exec(params.q)?.[1];
    const found = [...this.files.values()].filter(
      (f) => !f.trashed && f.key === key && f.parent === parent,
    );
    const page = found.slice(0, params.pageSize ?? found.length);
    return Promise.resolve({
      data: { files: page.map((f) => ({ id: f.id, mimeType: f.mimeType })) },
    });
  }

  create(params: {
    requestBody: {
      name: string;
      parents: string[];
      mimeType: string;
      appProperties: Record<string, string>;
    };
    media: { mimeType: string; body: Buffer };
  }): Promise<{ data: DriveFileMeta }> {
    this.gate();
    const id = `file-${++this.seq}`;
    this.files.set(id, {
      id,
      name: params.requestBody.name,
      key: params.requestBody.appProperties['key'] as string,
      parent: params.requestBody.parents[0] as string,
      mimeType: params.requestBody.mimeType,
      bytes: new Uint8Array(params.media.body),
      trashed: false,
    });
    return Promise.resolve({ data: { id, mimeType: params.requestBody.mimeType } });
  }

  get(params: { fileId: string; alt: 'media' }): Promise<{ data: unknown }> {
    this.gate();
    const f = this.files.get(params.fileId);
    if (f === undefined || f.trashed) {
      return Promise.reject(Object.assign(new Error('File not found.'), { code: '404' }));
    }
    return Promise.resolve({ data: new Uint8Array(f.bytes).buffer as ArrayBuffer });
  }

  update(params: { fileId: string; media: { mimeType: string; body: Buffer } }): Promise<unknown> {
    this.gate();
    const f = this.files.get(params.fileId);
    if (f === undefined) {
      return Promise.reject(Object.assign(new Error('File not found.'), { code: '404' }));
    }
    f.bytes = new Uint8Array(params.media.body);
    f.mimeType = params.media.mimeType;
    return Promise.resolve({ data: { id: f.id, mimeType: f.mimeType } });
  }

  delete(params: { fileId: string }): Promise<unknown> {
    this.gate();
    const f = this.files.get(params.fileId);
    if (f === undefined) {
      return Promise.reject(Object.assign(new Error('File not found.'), { code: '404' }));
    }
    f.trashed = true;
    return Promise.resolve({});
  }

  /** Test helper: plants a file directly (e.g. a duplicate or a name-only lookalike). */
  plant(name: string, key: string, mimeType: string, body: string): string {
    const id = `file-${++this.seq}`;
    this.files.set(id, {
      id,
      name,
      key,
      parent: APP_FOLDER,
      mimeType,
      bytes: new TextEncoder().encode(body),
      trashed: false,
    });
    return id;
  }
}

const make = (): DriveStorageProvider =>
  new DriveStorageProvider(new FakeDriveFilesClient(), APP_FOLDER);

// The full 9-test contract suite, unchanged, against the Drive adapter (B8, target 9/9).
storageProviderContract('DriveStorageProvider', make);

describe('DriveStorageProvider: key mapping and unhealthy states', () => {
  it('matches files by appProperties.key, never by the display name alone', async () => {
    const fake = new FakeDriveFilesClient();
    const p = new DriveStorageProvider(fake, APP_FOLDER);
    // a lookalike: same name, different appProperties key - must not be returned
    fake.plant('tenant-a/product-1/lookalike', 'someone-elses-key', 'image/webp', 'foreign');
    expect(await p.retrieve('tenant-a/product-1/lookalike')).toBeNull();
    await p.store({
      key: 'tenant-a/product-1/lookalike',
      bytes: new TextEncoder().encode('mine'),
      contentType: 'image/webp',
    });
    const got = await p.retrieve('tenant-a/product-1/lookalike');
    expect(got && new TextDecoder().decode(got.bytes)).toBe('mine');
  });

  it('two files for one canonical key is a clear conflict error, never a random pick', async () => {
    const fake = new FakeDriveFilesClient();
    const p = new DriveStorageProvider(fake, APP_FOLDER);
    const key = 'tenant-a/product-1/dup';
    fake.plant(key, key, 'image/webp', 'one');
    fake.plant(key, key, 'image/webp', 'two');
    await expect(p.retrieve(key)).rejects.toMatchObject({
      code: 'PROVIDER_FAILURE',
      reason: 'conflict',
    });
    await expect(p.delete(key)).rejects.toMatchObject({
      code: 'PROVIDER_FAILURE',
      reason: 'conflict',
    });
    await expect(
      p.store({ key, bytes: new TextEncoder().encode('x'), contentType: 'image/webp' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_FAILURE', reason: 'conflict' });
  });

  it('a file that vanishes between lookup and content fetch is not_found, not null', async () => {
    const fake = new FakeDriveFilesClient();
    const p = new DriveStorageProvider(fake, APP_FOLDER);
    const key = 'tenant-a/product-1/vanish';
    const id = fake.plant(key, key, 'image/webp', 'temp');
    const realGet = fake.get.bind(fake);
    fake.get = (params: { fileId: string; alt: 'media' }) => {
      fake.files.delete(id); // the object disappears right at content fetch
      return realGet(params);
    };
    await expect(p.retrieve(key)).rejects.toMatchObject({
      code: 'PROVIDER_FAILURE',
      reason: 'not_found',
    });
  });
});

describe('DriveStorageProvider: provider failures never become null/false', () => {
  const cases: Array<[string, unknown, string]> = [
    ['permission denied', { response: { status: 403 }, code: '403' }, 'permission_denied'],
    ['auth failure', { response: { status: 401 }, code: '401' }, 'auth_failed'],
    ['rate limiting', { response: { status: 429 }, code: '429' }, 'rate_limited'],
    ['google 5xx', { response: { status: 503 } }, 'server_error'],
    ['invalid request', { response: { status: 400 }, code: '400' }, 'invalid_request'],
    ['network/transport', { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }, 'network_error'],
    ['fetch failure', { message: 'fetch failed' }, 'network_error'],
    ['unclassified', { message: 'strange' }, 'unknown'],
  ];
  for (const [label, failure, reason] of cases) {
    it(`${label}: retrieve and delete raise PROVIDER_FAILURE(${reason})`, async () => {
      const fake = new FakeDriveFilesClient();
      const p = new DriveStorageProvider(fake, APP_FOLDER);
      fake.nextError = failure;
      await expect(p.retrieve('tenant-a/product-1/x')).rejects.toMatchObject({
        code: 'PROVIDER_FAILURE',
        reason,
      });
      fake.nextError = failure;
      await expect(p.delete('tenant-a/product-1/x')).rejects.toMatchObject({
        code: 'PROVIDER_FAILURE',
        reason,
      });
      fake.nextError = failure;
      await expect(
        p.store({
          key: 'tenant-a/product-1/x',
          bytes: new TextEncoder().encode('x'),
          contentType: 'image/webp',
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_FAILURE', reason });
    });
  }
});

describe('drive-error-mapper', () => {
  it('passes StorageError through unchanged', () => {
    const err = new StorageError('INVALID_REFERENCE');
    expect(mapDriveError(err)).toBe(err);
  });

  it('accepts numeric and string status codes from Gaxios-shaped errors', () => {
    expect(mapDriveError({ code: 404 }).reason).toBe('not_found');
    expect(mapDriveError({ code: '429' }).reason).toBe('rate_limited');
    expect(mapDriveError({ response: { status: 500 } }).reason).toBe('server_error');
    expect(mapDriveError(null).reason).toBe('unknown');
  });
});

describe('createDriveFilesClient (public API only, offline)', () => {
  it('builds the client through google.drive({ version: v3 }) with no network or OAuth call', () => {
    const client = createDriveFilesClient({
      clientId: 'dummy',
      clientSecret: 'dummy',
      refreshToken: 'dummy',
      folderId: APP_FOLDER,
    });
    // constructors only: no request was made; the public files surface is present
    expect(typeof client.list).toBe('function');
    expect(typeof client.create).toBe('function');
    expect(typeof client.get).toBe('function');
    expect(typeof client.update).toBe('function');
    expect(typeof client.delete).toBe('function');
  });
});
