import { ORPCError } from '@orpc/server';

/*
 * Fixed-window, in-memory rate limiter. Good for a single API process; move the
 * counters to Postgres or Redis when running several API instances.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Too many attempts. Try again in ${retryAfter} seconds.`,
      data: { retryAfter },
    });
  }
}

// Drop finished windows so the map does not grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
}, 60_000).unref();
