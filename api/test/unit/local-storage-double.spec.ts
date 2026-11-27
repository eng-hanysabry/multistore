import { LocalStorageDouble } from '../../src/modules/media/infrastructure/local-storage-double';
import { storageProviderContract } from '../contract/storage-provider.contract';

/**
 * The local test double must satisfy the full provider contract (IP-5 Step 5, item 12).
 * The Drive adapter (Step 8, separately approved) will run this same suite.
 */
storageProviderContract('LocalStorageDouble', () => new LocalStorageDouble());
