import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { and, eq, lt, organizations, videos, type Db, type Video } from '@repo/db';
import { env } from '../env';
import type { Redis } from '../redis';
import { buckets, r2, sourceKey } from '../storage/r2';
import { newVideoUid } from './ids';

/*
 * Upload core, shared by the dashboard, the tus endpoints and the
 * Stream-compatible API. Bytes stream straight into private R2: one tus chunk
 * becomes one R2 multipart part, nothing is written to local disk.
 */

const MiB = 1024 * 1024;
/** Cloudflare Stream's tus chunk rules (they also satisfy R2's multipart rules). */
export const CHUNK_MIN = 5 * MiB;
export const CHUNK_MAX = 200 * MiB;
export const CHUNK_MULTIPLE = 256 * 1024;
/** Basic (form) uploads are limited to 200 MB, as on Stream. */
export const BASIC_UPLOAD_MAX = 200 * MiB;

export class UploadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface NewVideoInput {
  orgId: string;
  createdBy?: string | null;
  size?: number | null;
  meta?: Record<string, unknown>;
  creator?: string | null;
  requireSignedUrls?: boolean;
  allowedOrigins?: string[];
  thumbnailTimestampPct?: number;
  scheduledDeletion?: Date | null;
  maxDurationSeconds?: number | null;
  maxSizeBytes?: number | null;
  uploadExpiry?: Date | null;
}

/** Creates a video waiting for its upload (state "pendingupload"). */
export async function createPendingVideo(db: Db, input: NewVideoInput): Promise<Video> {
  if (input.size != null) assertAcceptableSize(input.size, input.maxSizeBytes);
  const uid = newVideoUid();
  const [video] = await db
    .insert(videos)
    .values({
      uid,
      orgId: input.orgId,
      createdBy: input.createdBy ?? null,
      size: input.size ?? null,
      meta: input.meta ?? {},
      creator: input.creator ?? null,
      requireSignedUrls: input.requireSignedUrls ?? false,
      allowedOrigins: input.allowedOrigins ?? [],
      thumbnailTimestampPct: input.thumbnailTimestampPct ?? 0,
      scheduledDeletion: input.scheduledDeletion ?? null,
      maxDurationSeconds: input.maxDurationSeconds ?? null,
      maxSizeBytes: input.maxSizeBytes ?? null,
      uploadExpiry: input.uploadExpiry ?? null,
      sourceKey: sourceKey(input.orgId, uid),
    })
    .returning();
  return video!;
}

export function assertAcceptableSize(size: number, maxSizeBytes?: number | null) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new UploadError(400, 'The upload length must be a positive number of bytes.');
  }
  const limit = Math.min(env.MAX_UPLOAD_BYTES, maxSizeBytes ?? Infinity);
  if (size > limit) {
    throw new UploadError(413, `The file is larger than the allowed ${limit} bytes.`);
  }
}

/** A video that may still receive bytes, or an error explaining why not. */
export async function loadUploadableVideo(db: Db, uid: string): Promise<Video> {
  const [row] = await db
    .select({ video: videos, orgBannedAt: organizations.bannedAt })
    .from(videos)
    .innerJoin(organizations, eq(organizations.id, videos.orgId))
    .where(eq(videos.uid, uid))
    .limit(1);
  if (!row) throw new UploadError(404, 'Upload not found.');
  if (row.orgBannedAt) throw new UploadError(403, 'This organization has been suspended.');
  const { video } = row;
  if (video.state !== 'pendingupload') {
    throw new UploadError(410, 'This upload is already complete.');
  }
  // The expiry limits when an upload may start; one already under way may finish.
  if (video.uploadOffset === 0 && video.uploadExpiry && video.uploadExpiry <= new Date()) {
    throw new UploadError(410, 'This upload URL has expired.');
  }
  return video;
}

const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/** One upload at a time per video: two clients appending to the same upload would corrupt it. */
export async function withUploadLock<T>(redis: Redis, uid: string, fn: () => Promise<T>) {
  const key = `upload-lock:${uid}`;
  const owner = randomBytes(8).toString('hex');
  const ok = await redis.set(key, owner, 'PX', 30 * 60 * 1000, 'NX');
  if (!ok) throw new UploadError(423, 'Another request is uploading to this video right now.');
  try {
    return await fn();
  } finally {
    // Release only our own lock (it may have expired and been taken by another request).
    await redis.eval(RELEASE_LOCK, 1, key, owner).catch(() => {});
  }
}

/**
 * Appends one tus chunk at `offset` and returns the new offset.
 * The whole chunk becomes one R2 part, or nothing is recorded: an interrupted
 * chunk leaves the offset where it was, and the client resends that chunk.
 */
export async function appendChunk(
  db: Db,
  video: Video,
  offset: number,
  length: number,
  body: Readable,
  signal?: AbortSignal,
): Promise<{ offset: number; complete: boolean }> {
  if (video.size == null) throw new UploadError(400, 'Upload-Length is not known for this upload.');
  if (offset !== video.uploadOffset) {
    throw new UploadError(
      409,
      `Upload-Offset ${offset} does not match the server's ${video.uploadOffset}.`,
    );
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new UploadError(400, 'Each PATCH must send a non-empty chunk with Content-Length.');
  }
  if (offset + length > video.size) {
    throw new UploadError(400, 'This chunk goes past the declared Upload-Length.');
  }

  const isLast = offset + length === video.size;
  if (length > CHUNK_MAX) {
    throw new UploadError(400, `Chunks may be at most ${CHUNK_MAX} bytes (200 MiB).`);
  }
  if (!isLast) {
    if (length < CHUNK_MIN || length % CHUNK_MULTIPLE !== 0) {
      throw new UploadError(
        400,
        'Chunks must be at least 5,242,880 bytes and a multiple of 262,144 bytes (256 KiB), ' +
          'except the last one.',
      );
    }
    if (video.partSize != null && length !== video.partSize) {
      throw new UploadError(400, `All chunks except the last must be ${video.partSize} bytes.`);
    }
  } else if (video.partSize != null && length > video.partSize) {
    throw new UploadError(400, `The last chunk may not be larger than ${video.partSize} bytes.`);
  }

  let uploadId = video.uploadId;
  if (!uploadId) {
    const created = await r2.send(
      new CreateMultipartUploadCommand({ Bucket: buckets.source, Key: video.sourceKey! }),
    );
    uploadId = created.UploadId!;
    await db.update(videos).set({ uploadId }).where(eq(videos.uid, video.uid));
  }

  const partNumber = video.parts.length + 1;
  const part = await r2.send(
    new UploadPartCommand({
      Bucket: buckets.source,
      Key: video.sourceKey!,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: length,
    }),
    // A client that disconnects mid-chunk must not leave this request hanging.
    { abortSignal: signal },
  );
  const parts = [...video.parts, { PartNumber: partNumber, ETag: part.ETag! }];
  const newOffset = offset + length;
  await db
    .update(videos)
    .set({ parts, uploadOffset: newOffset, partSize: video.partSize ?? (isLast ? null : length) })
    .where(eq(videos.uid, video.uid));

  if (isLast) {
    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: buckets.source,
        Key: video.sourceKey!,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    await markUploaded(db, { ...video, parts, uploadOffset: newOffset });
  }
  return { offset: newOffset, complete: isLast };
}

/**
 * Basic (form) upload: streams one file into R2. Stream limits these to 200 MB.
 * `file` must error or end; the caller enforces the byte limit while streaming.
 */
export async function uploadWholeFile(db: Db, video: Video, file: Readable, signal?: AbortSignal) {
  const upload = new Upload({
    client: r2,
    params: { Bucket: buckets.source, Key: video.sourceKey!, Body: file },
    partSize: 8 * MiB,
    queueSize: 4,
  });
  const abort = () => void upload.abort().catch(() => {});
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  // If the client goes away, the file stream may simply stop: end it with an error.
  signal?.addEventListener(
    'abort',
    () => file.destroy(new UploadError(499, 'Client disconnected.')),
    {
      once: true,
    },
  );
  await upload.done();
  return markUploaded(db, video);
}

/** Checks the stored object and moves the video on to encoding. */
async function markUploaded(db: Db, video: Video) {
  const head = await r2.send(
    new HeadObjectCommand({ Bucket: buckets.source, Key: video.sourceKey! }),
  );
  const size = head.ContentLength ?? 0;
  const limit = Math.min(env.MAX_UPLOAD_BYTES, video.maxSizeBytes ?? Infinity);
  if ((video.size != null && size !== video.size) || size > limit || size === 0) {
    await r2
      .send(new DeleteObjectCommand({ Bucket: buckets.source, Key: video.sourceKey! }))
      .catch(() => {});
    await db
      .update(videos)
      .set({
        state: 'error',
        errorReasonCode: 'ERR_UNKNOWN',
        errorReasonText: `Stored size ${size} does not match the expected upload.`,
        uploadId: null,
      })
      .where(eq(videos.uid, video.uid));
    throw new UploadError(400, 'The uploaded file does not match the declared size.');
  }
  const [updated] = await db
    .update(videos)
    // "queued": waiting for the encoder (phase 2).
    .set({ state: 'queued', size, uploaded: new Date(), uploadId: null, parts: [] })
    .where(eq(videos.uid, video.uid))
    .returning();
  return updated!;
}

/** Removes a video's stored files (and any unfinished multipart upload), then the row. */
export async function deleteVideo(db: Db, video: Video) {
  if (video.uploadId) {
    await r2
      .send(
        new AbortMultipartUploadCommand({
          Bucket: buckets.source,
          Key: video.sourceKey!,
          UploadId: video.uploadId,
        }),
      )
      .catch(() => {});
  }
  if (video.sourceKey) {
    await r2
      .send(new DeleteObjectCommand({ Bucket: buckets.source, Key: video.sourceKey }))
      .catch(() => {});
  }
  // TODO (phase 2): also delete the encoded output in the delivery bucket.
  await db.delete(videos).where(eq(videos.uid, video.uid));
}

/** Deletes uploads that were never finished: expired before they started, or idle for 7 days. */
export async function sweepAbandonedUploads(db: Db) {
  const now = new Date();
  const idleSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(videos)
    .where(and(eq(videos.state, 'pendingupload'), lt(videos.modified, idleSince)));
  const expired = await db
    .select()
    .from(videos)
    .where(
      and(
        eq(videos.state, 'pendingupload'),
        eq(videos.uploadOffset, 0),
        lt(videos.uploadExpiry, now),
      ),
    );
  const seen = new Set<string>();
  for (const video of [...stale, ...expired]) {
    if (seen.has(video.uid)) continue;
    seen.add(video.uid);
    await deleteVideo(db, video).catch((err) => console.error('[sweep]', video.uid, err));
  }
  return seen.size;
}
