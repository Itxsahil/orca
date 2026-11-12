import { ORPCError } from '@orpc/server';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  and,
  apiTokens,
  asc,
  desc,
  eq,
  isNull,
  organizations,
  sql,
  videos,
  type Db,
  type SQL,
} from '@repo/db';
import { rateLimit } from '../auth/rate-limit';
import { hashToken } from '../auth/tokens';
import type { Redis } from '../redis';
import { isVideoUid } from './ids';
import { fail, ok, toStreamVideo } from './stream-format';
import { metadataToVideoInput, parseUploadMetadata } from './tus-metadata';
import { BASIC_UPLOAD_MAX, createPendingVideo, deleteVideo, UploadError } from './upload-core';
import { basicUploadUrl, tusUploadUrl } from './urls';

/*
 * Cloudflare Stream-compatible API. Switching from Stream means changing the
 * host to STREAM_PUBLIC_URL, the account id to the organization id and the token
 * to one of our API tokens. Clients reach it through the upload Worker, which
 * handles requests that carry video bytes (basic uploads) itself and passes
 * everything else on to these routes:
 *   POST   /client/v4/accounts/:accountId/stream                  basic upload (form) or tus creation
 *   POST   /client/v4/accounts/:accountId/stream/direct_upload    one-time upload URL
 *   GET    /client/v4/accounts/:accountId/stream                  list
 *   GET    /client/v4/accounts/:accountId/stream/:uid             get
 *   POST   /client/v4/accounts/:accountId/stream/:uid             update
 *   DELETE /client/v4/accounts/:accountId/stream/:uid             delete
 */

// Error codes as on the Cloudflare API: 10000 is "Authentication error".
export const AUTH_ERROR = 10000;
export const NOT_FOUND = 10003;
export const BAD_REQUEST = 10005;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

type Authed = Request & { orgId?: string };

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const videoSettings = z.object({
  allowedOrigins: z.array(z.string().max(255)).max(100).optional(),
  creator: z.string().max(64).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  requireSignedURLs: z.boolean().optional(),
  scheduledDeletion: isoDate.nullable().optional(),
  thumbnailTimestampPct: z.number().min(0).max(1).optional(),
  maxDurationSeconds: z.number().int().min(1).max(21600).optional(),
});
const directUploadBody = videoSettings.extend({
  expiry: isoDate.optional(),
  maxSizeBytes: z.number().int().positive().optional(),
});
const updateBody = videoSettings.extend({ uploadExpiry: isoDate.nullable().optional() });

/**
 * Checks `Authorization: Bearer <token>` against the organization (account id)
 * in the URL and returns the organization id.
 */
export async function authenticateToken(
  db: Db,
  redis: Redis,
  authorization: string | undefined,
  accountId: string,
  ip: string | undefined,
): Promise<string> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  const fail401 = () => new ApiError(401, AUTH_ERROR, 'Authentication error');
  if (!token || !z.uuid().safeParse(accountId).success) {
    await limitFailures(redis, ip);
    throw fail401();
  }
  const [row] = await db
    .select({ token: apiTokens, orgBannedAt: organizations.bannedAt })
    .from(apiTokens)
    .innerJoin(organizations, eq(organizations.id, apiTokens.orgId))
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (!row || row.token.orgId !== accountId) {
    await limitFailures(redis, ip);
    throw fail401();
  }
  if (row.orgBannedAt) throw new ApiError(403, AUTH_ERROR, 'This organization has been suspended.');
  // Recorded at most once a minute per token.
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, row.token.id),
        sql`(${apiTokens.lastUsedAt} is null or ${apiTokens.lastUsedAt} < now() - interval '1 minute')`,
      ),
    )
    .catch(() => {});
  return row.token.orgId;
}

function authenticate(db: Db, redis: Redis) {
  return async (req: Authed, _res: Response, next: NextFunction) => {
    try {
      req.orgId = await authenticateToken(
        db,
        redis,
        req.headers.authorization,
        String(req.params.accountId),
        req.ip,
      );
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function limitFailures(redis: Redis, ip: string | undefined) {
  try {
    await rateLimit(redis, `stream-auth:${ip ?? 'unknown'}`, 30, 60_000);
  } catch (err) {
    if (err instanceof ORPCError) throw new ApiError(429, AUTH_ERROR, err.message);
    throw err;
  }
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new ApiError(400, BAD_REQUEST, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

// Like the Cloudflare API, read JSON whatever the Content-Type: its own docs use
// `curl --data '{...}'`, which sends application/x-www-form-urlencoded.
const json = express.json({ limit: '1mb', type: () => true });

export function createStreamApi(db: Db, redis: Redis) {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate(db, redis));

  const findVideo = async (req: Authed) => {
    const uid = String(req.params.uid);
    if (!isVideoUid(uid)) throw new ApiError(404, NOT_FOUND, 'Video not found');
    const [video] = await db
      .select()
      .from(videos)
      .where(and(eq(videos.uid, uid), eq(videos.orgId, req.orgId!)))
      .limit(1);
    if (!video) throw new ApiError(404, NOT_FOUND, 'Video not found');
    return video;
  };

  // Direct creator upload: a one-time URL for a basic (form) upload.
  router.post('/direct_upload', json, async (req: Authed, res, next) => {
    try {
      const body = parse(directUploadBody, req.body);
      const now = Date.now();
      const expiry = body.expiry ?? new Date(now + 30 * 60 * 1000);
      if (expiry.getTime() < now + 2 * 60 * 1000 || expiry.getTime() > now + 6 * 60 * 60 * 1000) {
        throw new ApiError(
          400,
          BAD_REQUEST,
          'expiry must be between 2 minutes and 6 hours from now.',
        );
      }
      const video = await createPendingVideo(db, {
        orgId: req.orgId!,
        meta: body.meta,
        creator: body.creator,
        requireSignedUrls: body.requireSignedURLs,
        allowedOrigins: body.allowedOrigins,
        thumbnailTimestampPct: body.thumbnailTimestampPct,
        scheduledDeletion: body.scheduledDeletion,
        maxDurationSeconds: body.maxDurationSeconds,
        maxSizeBytes: Math.min(body.maxSizeBytes ?? BASIC_UPLOAD_MAX, BASIC_UPLOAD_MAX),
        uploadExpiry: expiry,
      });
      res.json(
        ok({
          uploadURL: basicUploadUrl(video.uid),
          uid: video.uid,
          scheduledDeletion: video.scheduledDeletion?.toISOString() ?? null,
          watermark: null,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // POST /stream: tus upload creation (Tus-Resumable header) or a basic upload (form).
  router.post('/', async (req: Authed, res, next) => {
    try {
      if (req.headers['tus-resumable']) {
        res.setHeader('Tus-Resumable', '1.0.0');
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers['tus-resumable'] !== '1.0.0') {
          res.setHeader('Tus-Version', '1.0.0');
          throw new UploadError(412, 'Only tus 1.0.0 is supported.');
        }
        const length = Number(req.headers['upload-length']);
        if (req.headers['upload-length'] == null) {
          throw new UploadError(
            400,
            'Upload-Length is required (deferred lengths are not supported).',
          );
        }
        const settings = metadataToVideoInput(
          parseUploadMetadata(req.headers['upload-metadata'] as string),
        );
        const creator = req.headers['upload-creator'];
        const video = await createPendingVideo(db, {
          ...settings,
          orgId: req.orgId!,
          size: length,
          creator: typeof creator === 'string' && creator ? creator.slice(0, 64) : null,
        });
        res.setHeader('Location', tusUploadUrl(video.uid));
        res.setHeader('stream-media-id', video.uid);
        if (video.uploadExpiry) res.setHeader('Upload-Expires', video.uploadExpiry.toUTCString());
        res.status(201).end();
        return;
      }
      // Basic uploads carry the video in the body; the upload Worker handles them.
      throw new ApiError(
        400,
        BAD_REQUEST,
        'Send uploads to the Stream API host (STREAM_PUBLIC_URL), not to this server.',
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req: Authed, res, next) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const where: SQL[] = [eq(videos.orgId, req.orgId!)];
      if (q.creator) where.push(eq(videos.creator, q.creator));
      if (q.status) {
        const states = ['pendingupload', 'downloading', 'queued', 'inprogress', 'ready', 'error'];
        if (!states.includes(q.status)) throw new ApiError(400, BAD_REQUEST, 'Unknown status.');
        where.push(eq(videos.state, q.status as (typeof videos.state.enumValues)[number]));
      }
      if (q.search)
        where.push(
          sql`${videos.meta}->>'name' ilike ${`%${q.search.replace(/[%_\\]/g, '\\$&')}%`}`,
        );
      for (const [key, op] of [
        ['start', '>='],
        ['end', '<'],
      ] as const) {
        if (!q[key]) continue;
        const date = new Date(q[key]);
        if (Number.isNaN(date.getTime()))
          throw new ApiError(400, BAD_REQUEST, `${key} must be a date.`);
        where.push(sql`${videos.created} ${sql.raw(op)} ${date}`);
      }
      const limit = Math.min(Math.max(Number(q.limit) || 1000, 1), 1000);
      const ascending = q.asc === 'true';
      const rows = await db
        .select()
        .from(videos)
        .where(and(...where))
        .orderBy(ascending ? asc(videos.created) : desc(videos.created))
        .limit(limit);
      const body: Record<string, unknown> = ok(rows.map(toStreamVideo));
      if (q.include_counts === 'true') {
        const [{ total }] = (await db
          .select({ total: sql<number>`count(*)::int` })
          .from(videos)
          .where(and(...where))) as [{ total: number }];
        body.total = total;
        body.range = rows.length;
      }
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:uid', async (req: Authed, res, next) => {
    try {
      res.json(ok(toStreamVideo(await findVideo(req))));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:uid', json, async (req: Authed, res, next) => {
    try {
      const video = await findVideo(req);
      const body = parse(updateBody, req.body);
      const [updated] = await db
        .update(videos)
        .set({
          allowedOrigins: body.allowedOrigins,
          creator: body.creator,
          meta: body.meta,
          requireSignedUrls: body.requireSignedURLs,
          scheduledDeletion: body.scheduledDeletion,
          thumbnailTimestampPct: body.thumbnailTimestampPct,
          maxDurationSeconds: body.maxDurationSeconds,
          uploadExpiry: body.uploadExpiry,
        })
        .where(eq(videos.uid, video.uid))
        .returning();
      res.json(ok(toStreamVideo(updated!)));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:uid', async (req: Authed, res, next) => {
    try {
      await deleteVideo(db, await findVideo(req));
      res.status(200).json(ok(''));
    } catch (err) {
      next(err);
    }
  });

  // Errors in Stream's envelope.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof ApiError)
      return void res.status(err.status).json(fail(err.code, err.message));
    if (err instanceof UploadError) {
      return void res.status(err.status).json(fail(BAD_REQUEST, err.message));
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      return void res.status(400).json(fail(BAD_REQUEST, 'The request body is not valid JSON.'));
    }
    if ((err as Error)?.name === 'AbortError' || _req.destroyed) return; // the client went away
    console.error('[stream-api]', err);
    res.status(500).json(fail(BAD_REQUEST, 'Internal error'));
  });

  return router;
}
