import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Db } from '@repo/db';
import { env } from '../env';
import type { Redis } from '../redis';
import { isVideoUid } from './ids';
import { ApiError, authenticateToken } from './stream-api';
import { toStreamVideo } from './stream-format';
import {
  abortBasicUpload,
  commitChunk,
  completeBasicUpload,
  createPendingVideo,
  deleteVideo,
  loadUploadableVideo,
  prepareChunk,
  startBasicUpload,
  terminateUpload,
  tusStatus,
  UploadError,
} from './upload-core';

/*
 * Called only by the upload Worker (header x-upload-worker-secret). The Worker
 * moves the bytes; these endpoints decide what is allowed and keep the state.
 *
 *   GET    /tus/:uid                 tus HEAD: offset, length, expiry
 *   POST   /tus/:uid/prepare         tus PATCH step 1: check chunk, presigned URL for its part
 *   POST   /tus/:uid/commit          tus PATCH step 2: record the stored part
 *   DELETE /tus/:uid                 tus termination
 *   POST   /basic/start              basic upload: one-time URL (uid) or API token
 *   POST   /basic/:uid/complete      basic upload finished
 *   POST   /basic/:uid/abort         basic upload failed
 *
 * Errors are { status, code?, message } with the matching HTTP status.
 */

const secret = Buffer.from(env.UPLOAD_WORKER_SECRET);

function requireWorker(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(String(req.headers['x-upload-worker-secret'] ?? ''));
  if (given.length !== secret.length || !timingSafeEqual(given, secret)) {
    return void res.status(401).json({ status: 401, message: 'Unauthorized' });
  }
  next();
}

const uidParam = (req: Request) => {
  const uid = String(req.params.uid);
  if (!isVideoUid(uid)) throw new UploadError(404, 'Upload not found.');
  return uid;
};

const chunkBody = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});
const commitBody = chunkBody.extend({
  partNumber: z.number().int().min(1).max(10000),
  etag: z.string().min(1).max(200),
});
const startBody = z.union([
  z.object({ uid: z.string() }),
  z.object({
    accountId: z.string(),
    authorization: z.string().optional(),
    ip: z.string().optional(),
  }),
]);
const lockBody = z.object({ lockToken: z.string().min(1) });
const completeBody = lockBody.extend({
  parts: z
    .array(z.object({ PartNumber: z.number().int().min(1), ETag: z.string().min(1) }))
    .max(10000),
  filename: z.string().max(255).optional(),
});
const abortBody = lockBody.extend({ discard: z.boolean() });

export function createInternalRouter(db: Db, redis: Redis) {
  const router = express.Router();
  router.use(requireWorker, express.json({ limit: '1mb' }));

  const handle =
    (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
      try {
        const result = await fn(req);
        res.status(200).json(result ?? { ok: true });
      } catch (err) {
        if (err instanceof UploadError) {
          return void res.status(err.status).json({ status: err.status, message: err.message });
        }
        if (err instanceof ApiError) {
          return void res
            .status(err.status)
            .json({ status: err.status, code: err.code, message: err.message });
        }
        if (err instanceof z.ZodError) {
          return void res.status(400).json({ status: 400, message: 'Invalid request.' });
        }
        console.error('[internal]', err);
        res.status(500).json({ status: 500, message: 'Upload failed. Try again.' });
      }
    };

  router.get(
    '/tus/:uid',
    handle((req) => tusStatus(db, uidParam(req))),
  );
  router.post(
    '/tus/:uid/prepare',
    handle((req) => {
      const body = chunkBody.parse(req.body);
      return prepareChunk(db, redis, uidParam(req), body.offset, body.length);
    }),
  );
  router.post(
    '/tus/:uid/commit',
    handle((req) => commitChunk(db, uidParam(req), commitBody.parse(req.body))),
  );
  router.delete(
    '/tus/:uid',
    handle((req) => terminateUpload(db, redis, uidParam(req))),
  );

  router.post(
    '/basic/start',
    handle(async (req) => {
      const body = startBody.parse(req.body);
      if ('uid' in body) {
        // One-time upload URL from direct_upload.
        if (!isVideoUid(body.uid)) throw new UploadError(404, 'Upload not found.');
        const video = await loadUploadableVideo(db, body.uid);
        return { ...(await startBasicUpload(db, redis, video)), discardOnFailure: false };
      }
      // POST /client/v4/accounts/:id/stream with a file: authenticate, then create the video.
      const orgId = await authenticateToken(db, redis, body.authorization, body.accountId, body.ip);
      const video = await createPendingVideo(db, { orgId });
      try {
        return { ...(await startBasicUpload(db, redis, video)), discardOnFailure: true };
      } catch (err) {
        await deleteVideo(db, video).catch(() => {});
        throw err;
      }
    }),
  );
  router.post(
    '/basic/:uid/complete',
    handle(async (req) => {
      const body = completeBody.parse(req.body);
      const video = await completeBasicUpload(db, redis, uidParam(req), body.lockToken, body);
      return { video: toStreamVideo(video) };
    }),
  );
  router.post(
    '/basic/:uid/abort',
    handle(async (req) => {
      const body = abortBody.parse(req.body);
      await abortBasicUpload(db, redis, uidParam(req), body.lockToken, body.discard);
    }),
  );

  return router;
}
