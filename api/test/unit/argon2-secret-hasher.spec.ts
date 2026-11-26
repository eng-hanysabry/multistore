import { Argon2SecretHasher } from '../../src/modules/auth/infrastructure/argon2-secret-hasher';

describe('Argon2id secret hashing (spec 9)', () => {
  const hasher = new Argon2SecretHasher();

  it('hashes with argon2id and the approved parameters, then verifies', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('hashes a 6-digit code and rejects near misses', async () => {
    const hash = await hasher.hash('654321');
    await expect(hasher.verify(hash, '654321')).resolves.toBe(true);
    await expect(hasher.verify(hash, '654322')).resolves.toBe(false);
  });

  it('two hashes of the same secret differ (random salt)', async () => {
    expect(await hasher.hash('same')).not.toEqual(await hasher.hash('same'));
  });

  it('a malformed or foreign hash is a clean false, never an exception', async () => {
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
    await expect(hasher.verify('$bcrypt$10$abcdef', 'x')).resolves.toBe(false);
  });
});
