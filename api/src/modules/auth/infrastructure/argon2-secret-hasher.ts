import * as argon2 from 'argon2';
import { SecretHasher } from '../domain/password-hasher';

/**
 * Argon2id, OWASP minimum parameters (m=19456 KiB, t=2, p=1): the same parameters
 * verified in the IP-4 step-1 evidence on Node 24 (~75 ms per hash).
 */
export class Argon2SecretHasher implements SecretHasher {
  private readonly options: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed or foreign hash format: treat as no match, never throw to the caller.
      return false;
    }
  }
}
