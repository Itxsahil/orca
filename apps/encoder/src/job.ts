import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { deliveryPrefix, eq, videos, type Db } from '@repo/db';
import { env } from './env';
import { encodeHls, thumbnail } from './encode';
import { ProcessError } from './ffmpeg';
import { ladder } from './ladder';
import { InputError, probe } from './probe';
import {
  markFailed,
  markReady,
  maxAttempts,
  renewLease,
  release,
  reportProgress,
  retryLater,
  type Job,
} from './queue';
import { deleteOutput, download, uploadDir } from './storage';

class Stopping extends Error {}
class LostJob extends Error {}

/** ffmpeg messages that mean the file is broken, not that we failed. */
const MALFORMED =
  /Invalid data found|moov atom not found|could not find codec parameters|Decoder \(codec .*\) not found|corrupt/i;

const log = (job: Job, ...args: unknown[]) =>
  console.log(`[encoder] ${job.video.uid} (try ${job.attempt})`, ...args);

/**
 * Encodes one claimed video: download → probe → HLS ladder + thumbnail →
 * upload to the delivery bucket → ready. `stop` aborts the job and puts the
 * video back in the queue (shutdown).
 */
export async function processJob(db: Db, job: Job, stop: AbortSignal) {
  const { video } = job;
  const prefix = deliveryPrefix(video.orgId, video.uid);
  const work = path.join(env.ENCODER_WORK_DIR, `${video.uid}-${job.attempt}`);
  const controller = new AbortController();
  const onStop = () => controller.abort(new Stopping());
  stop.addEventListener('abort', onStop, { once: true });

  // Renew the lease; if the video was deleted or taken over, stop working on it.
  const heartbeat = setInterval(() => {
    renewLease(db, job)
      .then((ok) => ok || controller.abort(new LostJob()))
      .catch(() => {});
  }, 30_000);

  const started = Date.now();
  try {
    if (job.attempt > maxAttempts()) {
      await markFailed(db, job, 'ERR_UNKNOWN', 'Encoding failed repeatedly.');
      return;
    }
    await mkdir(work, { recursive: true });
    const input = path.join(work, 'original');
    const out = path.join(work, 'out');

    await download(video.sourceKey!, input, controller.signal);
    const info = await probe(input, controller.signal);
    if (video.maxDurationSeconds && info.duration > video.maxDurationSeconds + 0.5) {
      throw new InputError(
        'ERR_DURATION_EXCEED_CONSTRAINT',
        `The video is ${Math.round(info.duration)} s long; the limit is ${video.maxDurationSeconds} s.`,
      );
    }
    const renditions = ladder(info);
    log(
      job,
      `${info.videoCodec} ${info.width}x${info.height} ${info.duration.toFixed(1)}s ` +
        `(${((await stat(input)).size / 1e6).toFixed(1)} MB) → ` +
        renditions.map((r) => `${Math.min(r.width, r.height)}p`).join(', '),
    );

    let lastReport = 0;
    await encodeHls(input, out, info, renditions, controller.signal, (fraction) => {
      if (Date.now() - lastReport < 2000) return;
      lastReport = Date.now();
      // Leave the last few percent for the thumbnail and the upload.
      void reportProgress(db, job, Math.floor(fraction * 95)).catch(() => {});
    });
    await thumbnail(input, out, info, video.thumbnailTimestampPct, controller.signal);
    const files = await uploadDir(out, prefix, controller.signal);

    const ready = await markReady(db, job, {
      duration: Math.round(info.duration * 1000) / 1000,
      width: info.width,
      height: info.height,
    });
    if (!ready) throw new LostJob();
    log(job, `ready: ${files} files in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (err) {
    const reason = controller.signal.aborted ? controller.signal.reason : err;
    if (reason instanceof Stopping) {
      log(job, 'stopping: back to the queue');
      await release(db, job).catch(() => {});
      return;
    }
    if (reason instanceof LostJob) {
      // Deleted meanwhile (remove what we uploaded), or another encoder took over (leave it).
      const [row] = await db
        .select({ uid: videos.uid })
        .from(videos)
        .where(eq(videos.uid, video.uid));
      if (!row) await deleteOutput(prefix).catch(() => {});
      log(job, row ? 'taken over by another encoder' : 'video deleted while encoding');
      return;
    }

    await deleteOutput(prefix).catch(() => {});
    if (err instanceof InputError) {
      log(job, `rejected: ${err.code} ${err.message}`);
      await markFailed(db, job, err.code, err.message);
    } else if (err instanceof ProcessError && MALFORMED.test(err.stderr)) {
      log(job, 'rejected: malformed input', err.stderr.trim().split('\n').slice(-3).join(' | '));
      await markFailed(
        db,
        job,
        'ERR_MALFORMED_VIDEO',
        'The video file is damaged or not supported.',
      );
    } else if (job.attempt >= maxAttempts()) {
      console.error(
        `[encoder] ${video.uid} failed for good:`,
        err,
        (err as ProcessError).stderr ?? '',
      );
      await markFailed(db, job, 'ERR_UNKNOWN', 'Encoding failed.');
    } else {
      console.error(
        `[encoder] ${video.uid} failed, will retry:`,
        err,
        (err as ProcessError).stderr ?? '',
      );
      await retryLater(db, job);
    }
  } finally {
    clearInterval(heartbeat);
    stop.removeEventListener('abort', onStop);
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
