import { Readable } from 'node:stream';
import busboy from 'busboy';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { eq, videos, type Db } from '@repo/db';
import { env } from '../env';
import type { Redis } from '../redis';
import { isVideoUid } from './ids';
import {
  appendChunk,
  BASIC_UPLOAD_MAX,
  deleteVideo,
  loadUploadableVideo,
  UploadError,
  uploadWholeFile,
  withUploadLock,
} from './upload-core';

/*
 * The upload host (Stream's equivalent is upload.videodelivery.net):
 *   POST   /upload/:uid        one-time basic upload (multipart/form-data, field "file", <= 200 MB)
 *   HEAD   /upload/tus/:uid    tus: current offset
 *   PATCH  /upload/tus/:uid    tus: append one chunk
 *   DELETE /upload/tus/:uid    tus: cancel the upload
 * The URLs are unguessable one-time capabilities, so any origin may use them.
 */

const TUS_VERSION = '1.0.0';
const TUS_HEADERS = [
  'Location',
  'Upload-Offset',
  'Upload-Length',
  'Upload-Expires',
  'Tus-Resumable',
  'Tus-Version',
  'Tus-Max-Size',
  'Tus-Extension',
  'stream-media-id',
];

export const tusCors = cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'Tus-Resumable',
    'Upload-Length',
    'Upload-Offset',
    'Upload-Metadata',
    'Upload-Creator',
    'Upload-Defer-Length',
    'X-HTTP-Method-Override',
    'X-Requested-With',
  ],
  exposedHeaders: TUS_HEADERS,
  maxAge: 86400,
});

export function basicUploadUrl(uid: string) {
  return `${env.API_PUBLIC_URL}/upload/${uid}`;
}

export function tusUploadUrl(uid: string) {
  return `${env.API_PUBLIC_URL}/upload/tus/${uid}`;
}

/** Headers every tus response carries. */
export function setTusHeaders(res: Response) {
  res.setHeader('Tus-Resumable', TUS_VERSION);
  res.setHeader('Cache-Control', 'no-store');
}

export function sendUploadError(res: Response, err: unknown) {
  if (res.headersSent) return;
  if (err instanceof UploadError) {
    res.status(err.status).type('text/plain').send(err.message);
    return;
  }
  if ((err as Error)?.name === 'AbortError' || res.req.destroyed) return; // the client went away
  console.error('[upload]', err);
  res.status(500).type('text/plain').send('Upload failed. Try again.');
}

/**
 * Reads one file field named "file" from a multipart/form-data request,
 * enforcing `maxBytes` while it streams.
 */
export function receiveFormFile(
  req: Request,
  maxBytes: number,
): Promise<{ file: Readable; filename: string | undefined }> {
  return new Promise((resolve, reject) => {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
      return reject(
        new UploadError(400, 'Send the video as multipart/form-data in a field named "file".'),
      );
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes + 1024 * 1024) {
      return reject(
        new UploadError(413, `Basic uploads are limited to ${maxBytes} bytes; use tus.`),
      );
    }
    let found = false;
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes } });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || found) return stream.resume();
      found = true;
      stream.on('limit', () => {
        stream.destroy(
          new UploadError(413, `Basic uploads are limited to ${maxBytes} bytes; use tus.`),
        );
      });
      resolve({ file: stream, filename: info.filename || undefined });
    });
    bb.on('error', reject);
    bb.on('close', () => {
      if (!found) reject(new UploadError(400, 'No file field named "file" was found.'));
    });
    req.pipe(bb);
  });
}

/** Aborts when the client disconnects before its request body was fully received. */
export function clientGone(req: Request): AbortSignal {
  const controller = new AbortController();
  if (req.destroyed && !req.complete) controller.abort();
  req.once('close', () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}

export function createUploadRouter(db: Db, redis: Redis) {
  const router = express.Router();
  router.use(tusCors);

  // tus discovery (and plain OPTIONS without CORS preflight headers).
  router.options('/tus/:uid', (_req, res) => {
    setTusHeaders(res);
    res.setHeader('Tus-Version', TUS_VERSION);
    res.setHeader('Tus-Max-Size', String(env.MAX_UPLOAD_BYTES));
    res.setHeader('Tus-Extension', 'creation,expiration,termination');
    res.status(204).end();
  });

  router.head('/tus/:uid', async (req, res) => {
    setTusHeaders(res);
    const uid = String(req.params.uid);
    if (!isVideoUid(uid)) return res.status(404).end();
    const [video] = await db.select().from(videos).where(eq(videos.uid, uid)).limit(1);
    if (!video || video.size == null) return res.status(404).end();
    res.setHeader(
      'Upload-Offset',
      String(video.state === 'pendingupload' ? video.uploadOffset : video.size),
    );
    res.setHeader('Upload-Length', String(video.size));
    if (video.uploadExpiry) res.setHeader('Upload-Expires', video.uploadExpiry.toUTCString());
    res.status(200).end();
  });

  const patch = async (req: Request, res: Response) => {
    setTusHeaders(res);
    try {
      const uid = String(req.params.uid);
      if (!isVideoUid(uid)) throw new UploadError(404, 'Upload not found.');
      if (req.headers['tus-resumable'] !== TUS_VERSION) {
        res.setHeader('Tus-Version', TUS_VERSION);
        throw new UploadError(412, 'Only tus 1.0.0 is supported.');
      }
      if (req.headers['content-type'] !== 'application/offset+octet-stream') {
        throw new UploadError(
          415,
          'PATCH requests must use Content-Type: application/offset+octet-stream.',
        );
      }
      const offset = Number(req.headers['upload-offset']);
      const length = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new UploadError(400, 'Missing Upload-Offset.');

      const signal = clientGone(req);
      const result = await withUploadLock(redis, uid, async () => {
        const video = await loadUploadableVideo(db, uid);
        return appendChunk(db, video, offset, length, req, signal);
      });
      res.setHeader('Upload-Offset', String(result.offset));
      res.status(204).end();
    } catch (err) {
      // If the client disconnected mid-chunk there is no one to answer; the offset is unchanged.
      req.resume();
      sendUploadError(res, err);
    }
  };
  router.patch('/tus/:uid', patch);
  // Some tus clients send POST + X-HTTP-Method-Override: PATCH.
  router.post('/tus/:uid', (req, res) => {
    if (String(req.headers['x-http-method-override']).toUpperCase() === 'PATCH')
      return void patch(req, res);
    res.status(405).end();
  });

  router.delete('/tus/:uid', async (req, res) => {
    setTusHeaders(res);
    try {
      const uid = String(req.params.uid);
      if (!isVideoUid(uid)) throw new UploadError(404, 'Upload not found.');
      await withUploadLock(redis, uid, async () => {
        const video = await loadUploadableVideo(db, uid);
        await deleteVideo(db, video);
      });
      res.status(204).end();
    } catch (err) {
      sendUploadError(res, err);
    }
  });

  // One-time basic upload URL from direct_upload.
  router.post('/:uid', async (req, res) => {
    try {
      const uid = String(req.params.uid);
      if (!isVideoUid(uid)) throw new UploadError(404, 'Upload not found.');
      await withUploadLock(redis, uid, async () => {
        const video = await loadUploadableVideo(db, uid);
        if (video.uploadOffset > 0) throw new UploadError(409, 'This upload was started with tus.');
        const limit = Math.min(BASIC_UPLOAD_MAX, video.maxSizeBytes ?? Infinity);
        const signal = clientGone(req);
        const { file, filename } = await receiveFormFile(req, limit);
        if (filename && video.meta.name == null) {
          video.meta = { ...video.meta, name: filename };
          await db.update(videos).set({ meta: video.meta }).where(eq(videos.uid, uid));
        }
        await uploadWholeFile(db, video, file, signal);
      });
      res.status(200).json({ result: null, success: true, errors: [], messages: [] });
    } catch (err) {
      req.resume();
      sendUploadError(res, err);
    }
  });

  return router;
}
