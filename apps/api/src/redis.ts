import { Redis } from 'ioredis';

export type { Redis };

/** Shared Redis connection: sessions, rate limits (and later queues, caches, ...). */
export function createRedis(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  redis.on('error', (err) => console.error('[redis]', err.message));
  return redis;
}
