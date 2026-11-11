import { and, eq, gt, lt, sessions, users, type Db, type User } from '@repo/db';
import { env } from '../env';
import type { Context } from '../context';
import { clearSessionCookie, readCookie, serializeSessionCookie, SESSION_COOKIE } from './cookies';
import { hashToken, newToken } from './tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const ttlMs = () => env.SESSION_TTL_DAYS * DAY_MS;

/** Creates a session row and sets the cookie on the response. */
export async function startSession(ctx: Context, userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await ctx.db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  ctx.resHeaders?.append('set-cookie', serializeSessionCookie(token, Math.floor(ttlMs() / 1000)));
}

/**
 * The logged-in user for this request, or null.
 * Sliding expiry: a session used in the second half of its life is extended.
 */
export async function getSessionUser(ctx: Context): Promise<User | null> {
  const token = readCookie(ctx.reqHeaders, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);

  const [row] = await ctx.db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < ttlMs() / 2) {
    await ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + ttlMs()) })
      .where(eq(sessions.tokenHash, tokenHash));
    ctx.resHeaders?.append('set-cookie', serializeSessionCookie(token, Math.floor(ttlMs() / 1000)));
  }
  return row.user;
}

/** Deletes this browser's session and clears the cookie. */
export async function endSession(ctx: Context): Promise<void> {
  const token = readCookie(ctx.reqHeaders, SESSION_COOKIE);
  if (token) await ctx.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  ctx.resHeaders?.append('set-cookie', clearSessionCookie());
}

/** Removes expired sessions. Called periodically by the API process. */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
