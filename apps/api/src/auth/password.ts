import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/*
 * Password hashing with Node's built-in scrypt.
 * Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 * The parameters are stored with each hash, so they can be raised later
 * without breaking existing passwords.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
// scrypt needs ~128 * N * r bytes (32 MiB here); Node's default cap is exactly 32 MiB.
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions & { keylen: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      opts.keylen,
      { ...opts, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await derive(password, salt, { N, r: R, p: P, keylen: KEY_LEN });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Hash of a random password, verified against when an email has no account,
 * so "unknown email" and "wrong password" take the same time.
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
