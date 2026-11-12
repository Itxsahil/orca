import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDb } from '@repo/db';
import { env } from './env';
import { processJob } from './job';
import { claimJob } from './queue';

/*
 * Video encoder. Run one or more of these on servers with ffmpeg installed
 * (see Dockerfile). Each takes "queued" videos from Postgres, encodes them to
 * HLS and stores the result in the private delivery bucket.
 */

const db = createDb(env.DATABASE_URL);
const stop = new AbortController();

async function worker(n: number) {
  while (!stop.signal.aborted) {
    let job;
    try {
      job = await claimJob(db);
    } catch (err) {
      console.error(`[encoder] worker ${n}: could not reach the database`, err);
    }
    if (!job) {
      // Idle: wait, with a little jitter so several encoders don't poll in step.
      await sleep(env.ENCODER_POLL_MS * (0.75 + Math.random() / 2), undefined, {
        signal: stop.signal,
      }).catch(() => {});
      continue;
    }
    await processJob(db, job, stop.signal);
  }
}

await mkdir(env.ENCODER_WORK_DIR, { recursive: true });
console.log(
  `[encoder] started: ${env.ENCODER_CONCURRENCY} at a time, preset ${env.ENCODER_PRESET}, work dir ${env.ENCODER_WORK_DIR}`,
);
const workers = Array.from({ length: env.ENCODER_CONCURRENCY }, (_, i) => worker(i + 1));

async function shutdown(signal: string) {
  if (stop.signal.aborted) return;
  console.log(`[encoder] ${signal}: finishing up, unfinished videos go back to the queue`);
  stop.abort();
  await Promise.all(workers);
  await db.$client.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
