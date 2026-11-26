/**
 * Spec 9: passwords and one-time codes are hashed with Argon2id. Codes are 6 digits, so
 * their hashes must never be logged or returned (same redaction rules as passwords, G-09).
 */
export interface SecretHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}
