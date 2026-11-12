import { and, eq, memberships, organizations, users, type Db, type User } from '@repo/db';
import { env } from '../env';
import type { Context } from '../context';
import type { Redis } from '../redis';
import { clearSessionCookie, readCookie, serializeSessionCookie, SESSION_COOKIE } from './cookies';
import { hashToken, newToken } from './tokens';

/*
 * Sessions live in Redis:
 *   session:<sha256 of cookie token>  → user id, expires with the session (sliding)
 *   user-sessions:<user id>           → set of that user's session hashes (to log out everywhere)
 * The cookie token itself is never stored.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ttlMs = () => env.SESSION_TTL_DAYS * DAY_MS;
const sessionKey = (hash: string) => `session:${hash}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

/** Creates a session and sets the cookie on the response. */
export async function startSession(ctx: Context, userId: string): Promise<void> {
  const token = newToken();
  const hash = hashToken(token);
  await ctx.redis
    .multi()
    .set(sessionKey(hash), userId, 'PX', ttlMs())
    .sadd(userSessionsKey(userId), hash)
    .pexpire(userSessionsKey(userId), ttlMs())
    .exec();
  void pruneUserSessions(ctx.redis, userId);
  ctx.resHeaders?.append('set-cookie', serializeSessionCookie(token, Math.floor(ttlMs() / 1000)));
}

/**
 * The logged-in user for this request, or null.
 * Banned users (or users whose organizations are all banned) are logged out on the spot.
 */
export async function getSessionUser(ctx: Context): Promise<User | null> {
  const token = readCookie(ctx.reqHeaders, SESSION_COOKIE);
  if (!token) return null;
  const hash = hashToken(token);

  const [userId, remainingMs] = await Promise.all([
    ctx.redis.get(sessionKey(hash)),
    ctx.redis.pttl(sessionKey(hash)),
  ]);
  if (!userId) return null;

  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || (await blockedReason(ctx.db, user))) {
    if (user) await revokeUserSessions(ctx.redis, user.id);
    else await ctx.redis.del(sessionKey(hash));
    ctx.resHeaders?.append('set-cookie', clearSessionCookie());
    return null;
  }

  // Sliding expiry: a session used in the second half of its life is extended.
  if (remainingMs > 0 && remainingMs < ttlMs() / 2) {
    await ctx.redis
      .multi()
      .pexpire(sessionKey(hash), ttlMs())
      .pexpire(userSessionsKey(userId), ttlMs())
      .exec();
    ctx.resHeaders?.append('set-cookie', serializeSessionCookie(token, Math.floor(ttlMs() / 1000)));
  }
  return user;
}

/** Ends this browser's session and clears the cookie. */
export async function endSession(ctx: Context): Promise<void> {
  const token = readCookie(ctx.reqHeaders, SESSION_COOKIE);
  if (token) {
    const hash = hashToken(token);
    const userId = await ctx.redis.get(sessionKey(hash));
    const tx = ctx.redis.multi().del(sessionKey(hash));
    if (userId) tx.srem(userSessionsKey(userId), hash);
    await tx.exec();
  }
  ctx.resHeaders?.append('set-cookie', clearSessionCookie());
}

/** Logs a user out of every browser (used when they or their organization are banned). */
export async function revokeUserSessions(redis: Redis, userId: string): Promise<void> {
  const hashes = await redis.smembers(userSessionsKey(userId));
  const tx = redis.multi().del(userSessionsKey(userId));
  for (const hash of hashes) tx.del(sessionKey(hash));
  await tx.exec();
}

/**
 * Why this user may not use the app right now, or null if they may.
 * The platform admin is never blocked.
 */
export async function blockedReason(db: Db, user: User): Promise<string | null> {
  if (user.isPlatformAdmin) return null;
  if (user.bannedAt) return 'This account has been suspended.';
  const orgs = await db
    .select({ bannedAt: organizations.bannedAt })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, user.id)));
  if (orgs.length > 0 && orgs.every((o) => o.bannedAt)) {
    return 'Your organization has been suspended.';
  }
  return null;
}

/** Drops hashes of expired sessions from the user's set, so it does not grow forever. */
async function pruneUserSessions(redis: Redis, userId: string): Promise<void> {
  try {
    const hashes = await redis.smembers(userSessionsKey(userId));
    if (hashes.length === 0) return;
    const exists = await Promise.all(hashes.map((h) => redis.exists(sessionKey(h))));
    const stale = hashes.filter((_, i) => exists[i] === 0);
    if (stale.length) await redis.srem(userSessionsKey(userId), ...stale);
  } catch {
    // Best effort only.
  }
}
