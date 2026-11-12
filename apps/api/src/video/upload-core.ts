import { randomBytes } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  and,
  eq,
  isNull,
  lt,
  organizations,
  videos,
  type Db,
  type UploadedPart,
  type Video,
} from '@repo/db';
import { env } from '../env';
import type { Redis } from '../redis';
import { buckets, r2, sourceKey } from '../storage/r2';
import { newVideoUid } from './ids';

/*
 * Upload state machine. The bytes never pass through this server: the upload
 * Worker (apps/upload-worker) asks permission for each piece, gets a
 * short-lived presigned R2 URL for exactly that part, sends the bytes to R2 and
 * reports back. Postgres holds the truth: offset, part list, state.
 *
 * tus: one tus chunk = one R2 multipart part, with Cloudflare Stream's chunk rules.
 * basic (form) uploads: the Worker cuts the file into BASIC_PART_SIZE parts.
 */

const MiB = 1024 * 1024;
/** Cloudflare Stream's tus chunk rules (they also satisfy R2's multipart rules). */
export const CHUNK_MIN = 5 * MiB;
export const CHUNK_MAX = 200 * MiB;
export const CHUNK_MULTIPLE = 256 * 1024;
/** Basic (form) uploads are limited to 200 MB, as on Stream. */
export const BASIC_UPLOAD_MAX = 200 * MiB;
/** Part size the Worker uses for basic uploads (R2 needs equal parts of at least 5 MiB). */
export const BASIC_PART_SIZE = 8 * MiB;
/** How long a presigned part URL works. */
const PART_URL_TTL_SECONDS = 60 * 60;

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

export async function findVideo(db: Db, uid: string): Promise<Video | null> {
  const [video] = await db.select().from(videos).where(eq(videos.uid, uid)).limit(1);
  return video ?? null;
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

/* ─── Basic-upload lock ─────────────────────────────────────── */

const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;
const lockKey = (uid: string) => `upload-lock:${uid}`;

/** A basic upload owns the video until it completes or aborts (or 30 minutes pass). */
async function acquireLock(redis: Redis, uid: string): Promise<string> {
  const token = randomBytes(16).toString('hex');
  const ok = await redis.set(lockKey(uid), token, 'PX', 30 * 60 * 1000, 'NX');
  if (!ok) throw new UploadError(423, 'Another request is uploading to this video right now.');
  return token;
}

async function assertLock(redis: Redis, uid: string, token: string) {
  if ((await redis.get(lockKey(uid))) !== token) {
    throw new UploadError(409, 'This upload is no longer in progress.');
  }
}

async function releaseLock(redis: Redis, uid: string, token: string) {
  await redis.eval(RELEASE_LOCK, 1, lockKey(uid), token).catch(() => {});
}

async function assertUnlocked(redis: Redis, uid: string) {
  if (await redis.exists(lockKey(uid))) {
    throw new UploadError(423, 'Another request is uploading to this video right now.');
  }
}

/* ─── R2 helpers ─────────────────────────────────────────────── */

/** Starts the R2 multipart upload once; concurrent first chunks agree on one. */
async function ensureMultipart(db: Db, video: Video): Promise<string> {
  if (video.uploadId) return video.uploadId;
  const created = await r2.send(
    new CreateMultipartUploadCommand({ Bucket: buckets.source, Key: video.sourceKey! }),
  );
  const [won] = await db
    .update(videos)
    .set({ uploadId: created.UploadId! })
    .where(and(eq(videos.uid, video.uid), isNull(videos.uploadId)))
    .returning({ uploadId: videos.uploadId });
  if (won) return won.uploadId!;
  // Another request started one first: use theirs, drop ours.
  await abortMultipart(video.sourceKey!, created.UploadId!);
  const fresh = await findVideo(db, video.uid);
  if (!fresh?.uploadId) throw new UploadError(409, 'The upload changed; retry this chunk.');
  return fresh.uploadId;
}

function presignPart(key: string, uploadId: string, partNumber: number, length?: number) {
  return getSignedUrl(
    r2,
    new UploadPartCommand({
      Bucket: buckets.source,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      ContentLength: length,
    }),
    { expiresIn: PART_URL_TTL_SECONDS },
  );
}

async function abortMultipart(key: string, uploadId: string) {
  await r2
    .send(new AbortMultipartUploadCommand({ Bucket: buckets.source, Key: key, UploadId: uploadId }))
    .catch(() => {});
}

/* ─── tus ────────────────────────────────────────────────────── */

/** What a tus HEAD reports. */
export async function tusStatus(db: Db, uid: string) {
  const video = await findVideo(db, uid);
  if (!video || video.size == null) throw new UploadError(404, 'Upload not found.');
  return {
    offset: video.state === 'pendingupload' ? video.uploadOffset : video.size,
    length: video.size,
    expires: video.uploadExpiry?.toISOString() ?? null,
  };
}

function checkChunk(video: Video, offset: number, length: number) {
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
  return isLast;
}

/**
 * Step 1 of a tus PATCH: check the chunk and hand out a presigned URL for its
 * R2 part. Nothing is recorded yet, so a chunk that never arrives changes nothing.
 */
export async function prepareChunk(
  db: Db,
  redis: Redis,
  uid: string,
  offset: number,
  length: number,
) {
  const video = await loadUploadableVideo(db, uid);
  await assertUnlocked(redis, uid);
  checkChunk(video, offset, length);
  const uploadId = await ensureMultipart(db, video);
  const partNumber = video.parts.length + 1;
  return { partNumber, url: await presignPart(video.sourceKey!, uploadId, partNumber, length) };
}

/**
 * Step 2 of a tus PATCH, after the part is in R2: record it. The offset only
 * moves if nobody else moved it first, so two clients racing on one upload
 * cannot both succeed. The last chunk completes the upload.
 */
export async function commitChunk(
  db: Db,
  uid: string,
  chunk: { offset: number; length: number; partNumber: number; etag: string },
) {
  const video = await loadUploadableVideo(db, uid);
  const isLast = checkChunk(video, chunk.offset, chunk.length);
  if (chunk.partNumber !== video.parts.length + 1 || !video.uploadId) {
    throw new UploadError(409, 'The upload changed; retry this chunk.');
  }
  const parts: UploadedPart[] = [
    ...video.parts,
    { PartNumber: chunk.partNumber, ETag: chunk.etag },
  ];
  const newOffset = chunk.offset + chunk.length;
  const [updated] = await db
    .update(videos)
    .set({
      parts,
      uploadOffset: newOffset,
      partSize: video.partSize ?? (isLast ? null : chunk.length),
    })
    .where(
      and(
        eq(videos.uid, uid),
        eq(videos.uploadOffset, chunk.offset),
        eq(videos.state, 'pendingupload'),
      ),
    )
    .returning();
  if (!updated) throw new UploadError(409, 'Another request uploaded this chunk first.');

  if (isLast) {
    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: buckets.source,
        Key: video.sourceKey!,
        UploadId: video.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    await markUploaded(db, updated);
  }
  return { offset: newOffset, complete: isLast };
}

/** tus termination: cancels the upload and deletes the video. */
export async function terminateUpload(db: Db, redis: Redis, uid: string) {
  const video = await loadUploadableVideo(db, uid);
  await assertUnlocked(redis, uid);
  await deleteVideo(db, video);
}

/* ─── Basic (form) uploads ───────────────────────────────────── */

/**
 * Starts a basic upload: locks the video and returns presigned URLs for every
 * part the file may need. The Worker cuts the stream into BASIC_PART_SIZE parts.
 */
export async function startBasicUpload(db: Db, redis: Redis, video: Video) {
  if (video.uploadOffset > 0) throw new UploadError(409, 'This upload was started with tus.');
  const lockToken = await acquireLock(redis, video.uid);
  try {
    const maxBytes = Math.min(BASIC_UPLOAD_MAX, video.maxSizeBytes ?? Infinity);
    const uploadId = await ensureMultipart(db, video);
    const count = Math.ceil(maxBytes / BASIC_PART_SIZE);
    const urls = await Promise.all(
      Array.from({ length: count }, (_, i) => presignPart(video.sourceKey!, uploadId, i + 1)),
    );
    return { uid: video.uid, lockToken, maxBytes, partSize: BASIC_PART_SIZE, urls };
  } catch (err) {
    await releaseLock(redis, video.uid, lockToken);
    throw err;
  }
}

export async function completeBasicUpload(
  db: Db,
  redis: Redis,
  uid: string,
  lockToken: string,
  input: { parts: UploadedPart[]; filename?: string },
) {
  await assertLock(redis, uid, lockToken);
  try {
    const video = await loadUploadableVideo(db, uid);
    if (!video.uploadId || input.parts.length === 0) {
      throw new UploadError(400, 'The file is empty.');
    }
    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: buckets.source,
        Key: video.sourceKey!,
        UploadId: video.uploadId,
        MultipartUpload: { Parts: input.parts },
      }),
    );
    if (input.filename && video.meta.name == null) {
      video.meta = { ...video.meta, name: input.filename };
      await db.update(videos).set({ meta: video.meta }).where(eq(videos.uid, uid));
    }
    return await markUploaded(db, video);
  } finally {
    await releaseLock(redis, uid, lockToken);
  }
}

/** Gives up a basic upload. `discard` also deletes the video (it was created for it). */
export async function abortBasicUpload(
  db: Db,
  redis: Redis,
  uid: string,
  lockToken: string,
  discard: boolean,
) {
  await assertLock(redis, uid, lockToken);
  try {
    const video = await findVideo(db, uid);
    if (!video) return;
    if (discard) return await deleteVideo(db, video);
    if (video.uploadId) await abortMultipart(video.sourceKey!, video.uploadId);
    await db.update(videos).set({ uploadId: null, parts: [] }).where(eq(videos.uid, uid));
  } finally {
    await releaseLock(redis, uid, lockToken);
  }
}

/* ─── Shared ─────────────────────────────────────────────────── */

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
  if (video.uploadId) await abortMultipart(video.sourceKey!, video.uploadId);
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
