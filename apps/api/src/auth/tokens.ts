import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for session cookies and invite links. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What we store instead of the token, so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
