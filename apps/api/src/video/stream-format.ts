import type { Video } from '@repo/db';
import { env } from '../env';

/*
 * Cloudflare Stream's video object, field for field, so Stream clients can read
 * our responses unchanged. Playback URLs follow Stream's shape
 * (<host>/<uid>/manifest/video.m3u8); they start working with phase 3.
 */
export function toStreamVideo(v: Video) {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const base = `${env.API_PUBLIC_URL}/media/${v.uid}`;
  return {
    uid: v.uid,
    creator: v.creator,
    thumbnail: `${base}/thumbnails/thumbnail.jpg`,
    thumbnailTimestampPct: v.thumbnailTimestampPct,
    readyToStream: v.state === 'ready',
    readyToStreamAt: iso(v.readyToStreamAt),
    status: {
      state: v.state,
      pctComplete: v.pctComplete == null ? '' : String(v.pctComplete),
      errorReasonCode: v.errorReasonCode ?? '',
      errorReasonText: v.errorReasonText ?? '',
    },
    meta: v.meta,
    created: v.created.toISOString(),
    modified: v.modified.toISOString(),
    scheduledDeletion: iso(v.scheduledDeletion),
    size: v.size ?? 0,
    preview: `${base}/watch`,
    allowedOrigins: v.allowedOrigins,
    requireSignedURLs: v.requireSignedUrls,
    uploaded: iso(v.uploaded),
    uploadExpiry: iso(v.uploadExpiry),
    maxSizeBytes: v.maxSizeBytes,
    maxDurationSeconds: v.maxDurationSeconds,
    duration: v.duration ?? -1,
    input: { width: v.width ?? -1, height: v.height ?? -1 },
    playback: { hls: `${base}/manifest/video.m3u8`, dash: `${base}/manifest/video.mpd` },
    watermark: null,
  };
}
export type StreamVideo = ReturnType<typeof toStreamVideo>;

/** Stream's response envelope. */
export const ok = <T>(result: T) => ({ result, success: true, errors: [], messages: [] });
export const fail = (code: number, message: string) => ({
  result: null,
  success: false,
  errors: [{ code, message }],
  messages: [],
});
