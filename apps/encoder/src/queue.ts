import { sql, type Db, type Video } from '@repo/db';
import { env } from './env';

/*
 * The job queue is the videos table itself: "queued" videos wait for an encoder.
 * An encoder claims one with FOR UPDATE SKIP LOCKED, so several encoders on several
 * servers never take the same video. While it works it renews a short lease; if it
 * crashes the lease runs out and another encoder picks the video up again.
 *
 * encode_attempts doubles as a fencing token: every claim increments it, and an
 * encoder only writes while the count is still the one it claimed with. A stalled
 * encoder whose job was taken over can therefore not overwrite the new one.
 *
 * For a queued video, encode_lease_until means "not before": a retry waits a while
 * so a short storage or network outage does not use up every attempt at once.
 */

export const LEASE_SECONDS = 120;

export interface Job {
  video: Video;
  attempt: number;
}

type Row = Record<string, unknown>;

/** Maps a raw snake_case row to the Drizzle Video shape. */
function toVideo(row: Row): Video {
  const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  for (const k of ['size', 'uploadOffset', 'maxSizeBytes']) {
    if (out[k] != null) out[k] = Number(out[k]);
  }
  return out as unknown as Video;
}

/** Claims the oldest waiting video (or one whose encoder died), or returns null. */
export async function claimJob(db: Db): Promise<Job | null> {
  const result = await db.execute(sql`
    update videos
       set state = 'inprogress',
           pct_complete = 0,
           encode_attempts = encode_attempts + 1,
           encode_lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
           modified = now()
     where uid = (
       select uid from videos
        where (state = 'queued' and (encode_lease_until is null or encode_lease_until < now()))
           or (state = 'inprogress' and encode_lease_until < now())
        order by uploaded nulls last
        limit 1
        for update skip locked
     )
    returning *`);
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  const video = toVideo(row);
  return { video, attempt: video.encodeAttempts };
}

/** Runs `update` only while this encoder still owns the job. Returns whether it did. */
async function owned(db: Db, job: Job, set: ReturnType<typeof sql>) {
  const result = await db.execute(sql`
    update videos set ${set}, modified = now()
     where uid = ${job.video.uid}
       and state = 'inprogress'
       and encode_attempts = ${job.attempt}`);
  return (result.rowCount ?? 0) > 0;
}

export const renewLease = (db: Db, job: Job) =>
  owned(db, job, sql`encode_lease_until = now() + make_interval(secs => ${LEASE_SECONDS})`);

export const reportProgress = (db: Db, job: Job, pct: number) =>
  owned(db, job, sql`pct_complete = ${pct}`);

export const markReady = (
  db: Db,
  job: Job,
  info: { duration: number; width: number; height: number },
) =>
  owned(
    db,
    job,
    sql`state = 'ready', pct_complete = 100, duration = ${info.duration},
        width = ${info.width}, height = ${info.height}, ready_to_stream_at = now(),
        encode_lease_until = null, error_reason_code = null, error_reason_text = null`,
  );

/** A failure that encoding again will not fix (Stream's error codes). */
export const markFailed = (db: Db, job: Job, code: string, text: string) =>
  owned(
    db,
    job,
    sql`state = 'error', pct_complete = null, encode_lease_until = null,
        error_reason_code = ${code}, error_reason_text = ${text}`,
  );

/** A failed attempt: back in the queue after a delay that doubles each time. */
export const retryLater = (db: Db, job: Job) => {
  const delay = env.ENCODER_RETRY_DELAY_SECONDS * 2 ** (job.attempt - 1);
  return owned(
    db,
    job,
    sql`state = 'queued', pct_complete = null,
        encode_lease_until = now() + make_interval(secs => ${delay})`,
  );
};

/** This encoder is stopping: back in the queue at once, and the attempt does not count. */
export const release = (db: Db, job: Job) =>
  owned(
    db,
    job,
    sql`state = 'queued', pct_complete = null, encode_lease_until = null,
        encode_attempts = encode_attempts - 1`,
  );

export const maxAttempts = () => env.ENCODER_MAX_ATTEMPTS;
