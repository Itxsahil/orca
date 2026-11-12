import { ORPCError } from '@orpc/server';
import type { Redis } from '../redis';

/*
 * Fixed-window rate limiter in Redis, so limits hold across several API processes.
 *   rl:<key> → attempts in the current window, expires when the window ends
 */
export async function rateLimit(
  redis: Redis,
  key: string,
  max: number,
  windowMs: number,
): Promise<void> {
  const redisKey = `rl:${key}`;
  const [[, count], [, ttl]] = (await redis.multi().incr(redisKey).pttl(redisKey).exec()) as [
    [null, number],
    [null, number],
  ];
  // First hit of a window (or a key that somehow lost its expiry): start the window.
  if (count === 1 || ttl < 0) await redis.pexpire(redisKey, windowMs);
  if (count > max) {
    const retryAfter = Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000));
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Too many attempts. Try again in ${retryAfter} seconds.`,
      data: { retryAfter },
    });
  }
}
