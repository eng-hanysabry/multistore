import { OAuth2Client } from 'google-auth-library';
import { StorageError } from '../domain/storage-errors';
import {
  assertContentType,
  assertObjectKey,
  RetrievedObject,
  StorageProvider,
  StoreObjectInput,
  StoredObject,
} from '../domain/storage-provider';
import { mapDriveError } from './drive-error-mapper';

/**
 * Google Drive StorageProvider (IP-5 Step 8, local implementation). Implements the
 * unchanged Step 5 port over the SUPPORTED PUBLIC googleapis surface only
 * (`google.drive({ version: 'v3', auth })`, decision J12): no internal package paths.
 *
 * Key mapping: the provider-neutral object key (media/{tenantId}/{assetId}/{variant}/{generation})
 * is the canonical reference and is what media_assets.drive_file_key stores. Inside
 * Drive, every object lives in the configured app folder with name = key and
 * appProperties.key = key; lookups match on appProperties (never on the filename alone),
 * so renames or display-name collisions cannot corrupt the mapping. More than one file
 * matching the same canonical key is an unhealthy state: the adapter raises a clear
 * PROVIDER_FAILURE(conflict) instead of picking one at random.
 *
 * Overwrite semantics: store() updates the existing file's content when the key exists,
 * creates it otherwise. delete() is idempotent (missing key -> false). All Drive
 * failures go through mapDriveError: nothing is silently converted to null/false and
 * there are no automatic retries (DI-1 remains Deferred).
 *
 * The adapter never exposes Drive file IDs, URLs or provider fields: the port's
 * StoredObject/RetrievedObject carry only key, contentType, byteSize and bytes.
 */

const DRIVE_CALL_TIMEOUT_MS = 10_000; // parity with the Gmail transport (10.7); a timeout is not a retry

/** The file metadata fields the adapter reads from list/create responses. */
export interface DriveFileMeta {
  readonly id?: string | null;
  readonly mimeType?: string | null;
}

/**
 * The minimal slice of the public Drive v3 `files` resource the adapter uses. The real
 * client comes from `google.drive({ version: 'v3', auth }).files`; tests inject a fake
 * implementing exactly this surface (authorization B7: no network in tests).
 */
export interface DriveFilesClient {
  list(params: {
    q: string;
    pageSize?: number;
    fields?: string;
    spaces?: string;
  }): Promise<{ data: { files?: DriveFileMeta[] | null } }>;
  create(params: {
    requestBody: {
      name: string;
      parents: string[];
      mimeType: string;
      appProperties: Record<string, string>;
    };
    media: { mimeType: string; body: Buffer };
    fields?: string;
  }): Promise<{ data: DriveFileMeta }>;
  get(
    params: { fileId: string; alt: 'media' },
    options?: { responseType?: 'arraybuffer'; timeout?: number },
  ): Promise<{ data: unknown }>;
  update(params: { fileId: string; media: { mimeType: string; body: Buffer } }): Promise<unknown>;
  delete(params: { fileId: string }): Promise<unknown>;
}

/** Credentials needed to build the real client. Used only by the factory; never logged. */
export interface DriveCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly folderId: string;
}

/**
 * The package-root public entry point, typed minimally (decision J12: public API only,
 * no internal paths such as googleapis/build/src/apis/drive/v3). A typed import of the
 * root makes tsc bind every Google API's type surface (~400 APIs) and exhausts memory —
 * the same reason the Gmail transport predates J12 with a narrow import. The minimal
 * structural type below covers exactly the two root members this adapter uses; the real
 * implementations are the supported public ones.
 */
interface GoogleapisPublicRoot {
  readonly auth: {
    readonly OAuth2: new (clientId: string, clientSecret?: string) => OAuth2Client;
  };
  readonly drive: (options: { version: 'v3'; auth: OAuth2Client }) => {
    files: DriveFilesClient;
  };
}

/**
 * Builds the real Drive files client through the public googleapis entry point
 * (`google.drive({ version: 'v3', auth })`, the package's documented root usage). The
 * require is lazy so importing this module stays cheap and tests inject fakes without
 * loading googleapis at all. This only constructs objects - no OAuth flow, token
 * refresh or network call happens here; the first network operation would be the first
 * files.* call.
 */
export function createDriveFilesClient(c: DriveCredentials): DriveFilesClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- package-root public entry, minimally typed (see GoogleapisPublicRoot note)
  const { google } = require('googleapis') as { google: GoogleapisPublicRoot };
  const auth = new google.auth.OAuth2(c.clientId, c.clientSecret);
  auth.setCredentials({ refresh_token: c.refreshToken });
  return google.drive({ version: 'v3', auth }).files;
}

export class DriveStorageProvider implements StorageProvider {
  constructor(
    private readonly files: DriveFilesClient,
    private readonly folderId: string,
  ) {}

  async store(input: StoreObjectInput): Promise<StoredObject> {
    assertObjectKey(input.key);
    assertContentType(input.contentType);
    const existing = await this.lookup(input.key);
    const body = Buffer.from(input.bytes);
    if (existing !== null) {
      await this.call(() =>
        this.files.update({
          fileId: existing[0],
          media: { mimeType: input.contentType, body },
        }),
      );
    } else {
      await this.call(() =>
        this.files.create({
          requestBody: {
            name: input.key,
            parents: [this.folderId],
            mimeType: input.contentType,
            appProperties: { key: input.key },
          },
          media: { mimeType: input.contentType, body },
          fields: 'id,mimeType',
        }),
      );
    }
    return { key: input.key, contentType: input.contentType, byteSize: input.bytes.byteLength };
  }

  async retrieve(key: string): Promise<RetrievedObject | null> {
    assertObjectKey(key);
    const existing = await this.lookup(key);
    if (existing === null) return null;
    const res = await this.call(() =>
      this.files.get(
        { fileId: existing[0], alt: 'media' },
        { responseType: 'arraybuffer', timeout: DRIVE_CALL_TIMEOUT_MS },
      ),
    );
    const bytes = toBytes(res.data);
    return {
      key,
      contentType: existing[1],
      byteSize: bytes.byteLength,
      bytes,
    };
  }

  async delete(key: string): Promise<boolean> {
    assertObjectKey(key);
    const existing = await this.lookup(key);
    if (existing === null) return false;
    await this.call(() => this.files.delete({ fileId: existing[0] }));
    return true;
  }

  /**
   * Resolves the canonical key to exactly one Drive file, matched on appProperties.key
   * inside the app folder (never on the display name alone). The key charset is
   * restricted by assertObjectKey, so the query literal needs no escaping.
   * Zero or one match is healthy; two or more is a corrupted mapping and is a clear
   * error, never a random pick.
   */
  private async lookup(key: string): Promise<[string, string] | null> {
    const res = await this.call(() =>
      this.files.list({
        q: `'${this.folderId}' in parents and appProperties has { key='key' and value='${key}' } and trashed = false`,
        pageSize: 2,
        fields: 'files(id,mimeType)',
        spaces: 'drive',
      }),
    );
    const files = res.data.files ?? [];
    if (files.length > 1) {
      throw new StorageError('PROVIDER_FAILURE', 'conflict');
    }
    const file = files[0];
    if (file?.id === undefined || file?.id === null) {
      return null;
    }
    return [file.id, file.mimeType ?? 'application/octet-stream'];
  }

  private async call<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      throw mapDriveError(err);
    }
  }
}

/** googleapis returns ArrayBuffer with responseType arraybuffer; accept Buffer/string too (fakes). */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new StorageError('PROVIDER_FAILURE', 'unknown');
}
