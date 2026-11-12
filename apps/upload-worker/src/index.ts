import { boundaryOf, MultipartError, readFileField } from './multipart';

/*
 * Upload Worker: the public host for the Cloudflare Stream-compatible API.
 *
 *   /upload/tus/:uid                           tus HEAD / PATCH / DELETE / OPTIONS
 *   /upload/:uid                               one-time basic upload (direct_upload)
 *   POST /client/v4/accounts/:id/stream        basic upload with an API token (multipart body)
 *   /client/v4/*                               everything else: passed to the API server
 *
 * Video bytes go from the client through this Worker straight into R2, using
 * presigned part URLs the API hands out per part. The API server only sees
 * small JSON calls (/internal/uploads) and never the video itself.
 */

export interface Env {
  API_ORIGIN: string;
  UPLOAD_WORKER_SECRET: string;
}

const TUS_VERSION = '1.0.0';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Offset, Upload-Metadata, ' +
    'Upload-Creator, Upload-Defer-Length, X-HTTP-Method-Override, X-Requested-With',
  'Access-Control-Expose-Headers':
    'Location, Upload-Offset, Upload-Length, Upload-Expires, Tus-Resumable, Tus-Version, ' +
    'Tus-Extension, stream-media-id',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 10005,
  ) {
    super(message);
  }
}

/* ─── API calls ──────────────────────────────────────────────── */

async function api<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.API_ORIGIN}/internal/uploads${path}`, {
    method,
    headers: {
      'x-upload-worker-secret': env.UPLOAD_WORKER_SECRET,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: number;
    code?: number;
    message?: string;
  };
  if (!res.ok) {
    throw new HttpError(res.status, data.message ?? 'Upload failed. Try again.', data.code);
  }
  return data as T;
}

/** Sends one part to R2 through its presigned URL and returns the part's ETag. */
async function putPart(url: string, body: BodyInit): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body });
  if (!res.ok) {
    console.error('R2 part upload failed', res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'Storing the upload failed. Try again.');
  }
  const etag = res.headers.get('etag');
  if (!etag) throw new HttpError(502, 'Storing the upload failed. Try again.');
  return etag;
}

/* ─── Responses ──────────────────────────────────────────────── */

const envelope = (result: unknown) => ({ result, success: true, errors: [], messages: [] });
const failure = (err: HttpError) => ({
  result: null,
  success: false,
  errors: [{ code: err.code, message: err.message }],
  messages: [],
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof MultipartError) return new HttpError(400, err.message);
  console.error(err);
  return new HttpError(500, 'Upload failed. Try again.');
}

/* ─── tus ────────────────────────────────────────────────────── */

async function handleTus(request: Request, env: Env, uid: string): Promise<Response> {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Tus-Resumable': TUS_VERSION,
    'Cache-Control': 'no-store',
  };
  const text = (status: number, message = '') =>
    new Response(message || null, {
      status,
      headers: { ...headers, 'content-type': 'text/plain' },
    });

  let method = request.method;
  if (
    method === 'POST' &&
    request.headers.get('x-http-method-override')?.toUpperCase() === 'PATCH'
  ) {
    method = 'PATCH';
  }

  try {
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'Tus-Version': TUS_VERSION,
          'Tus-Extension': 'creation,expiration,termination',
        },
      });
    }

    if (method === 'HEAD') {
      const status = await api<{ offset: number; length: number; expires: string | null }>(
        env,
        'GET',
        `/tus/${uid}`,
      );
      const out: Record<string, string> = {
        ...headers,
        'Upload-Offset': String(status.offset),
        'Upload-Length': String(status.length),
      };
      if (status.expires) out['Upload-Expires'] = new Date(status.expires).toUTCString();
      return new Response(null, { status: 200, headers: out });
    }

    if (method === 'DELETE') {
      await api(env, 'DELETE', `/tus/${uid}`);
      return new Response(null, { status: 204, headers });
    }

    if (method !== 'PATCH') return text(405);

    if (request.headers.get('tus-resumable') !== TUS_VERSION) {
      return new Response('Only tus 1.0.0 is supported.', {
        status: 412,
        headers: { ...headers, 'Tus-Version': TUS_VERSION },
      });
    }
    if (request.headers.get('content-type') !== 'application/offset+octet-stream') {
      return text(415, 'PATCH requests must use Content-Type: application/offset+octet-stream.');
    }
    const offset = Number(request.headers.get('upload-offset'));
    if (!Number.isSafeInteger(offset) || offset < 0) return text(400, 'Missing Upload-Offset.');
    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader == null) return text(411, 'PATCH requests need a Content-Length.');
    const length = Number(lengthHeader);

    // 1. The API checks the chunk and returns a presigned URL for its R2 part.
    const part = await api<{ partNumber: number; url: string }>(
      env,
      'POST',
      `/tus/${uid}/prepare`,
      {
        offset,
        length,
      },
    );
    // 2. Stream the chunk into R2. FixedLengthStream sets Content-Length and fails if
    //    the client sends fewer bytes (e.g. it disconnects): then nothing is recorded.
    const { readable, writable } = new FixedLengthStream(length);
    const [etag] = await Promise.all([putPart(part.url, readable), request.body!.pipeTo(writable)]);
    // 3. Record the part; the API completes the upload after the last one.
    const committed = await api<{ offset: number }>(env, 'POST', `/tus/${uid}/commit`, {
      offset,
      length,
      partNumber: part.partNumber,
      etag,
    });
    return new Response(null, {
      status: 204,
      headers: { ...headers, 'Upload-Offset': String(committed.offset) },
    });
  } catch (err) {
    const e = toHttpError(err);
    return method === 'HEAD'
      ? new Response(null, { status: e.status, headers })
      : text(e.status, e.message);
  }
}

/* ─── Basic (form) uploads ───────────────────────────────────── */

interface BasicStart {
  uid: string;
  lockToken: string;
  maxBytes: number;
  partSize: number;
  urls: string[];
  discardOnFailure: boolean;
}

/**
 * Streams the "file" field of a multipart body into R2 in fixed-size parts and
 * returns the finished video (Stream's video object).
 */
async function streamFormUpload(request: Request, env: Env, start: BasicStart) {
  try {
    const boundary = boundaryOf(request.headers.get('content-type'));
    if (!boundary || !request.body) {
      throw new HttpError(400, 'Send the video as multipart/form-data in a field named "file".');
    }
    const field = await readFileField(request.body, boundary);
    if (!field) throw new HttpError(400, 'No file field named "file" was found.');

    const parts: { PartNumber: number; ETag: string }[] = [];
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let total = 0;

    const flush = async (size: number) => {
      const part = new Uint8Array(size);
      let filled = 0;
      while (filled < size) {
        const chunk = pending[0]!;
        const take = Math.min(chunk.length, size - filled);
        part.set(chunk.subarray(0, take), filled);
        filled += take;
        if (take === chunk.length) pending.shift();
        else pending[0] = chunk.subarray(take);
      }
      pendingBytes -= size;
      const url = start.urls[parts.length];
      if (!url)
        throw new HttpError(413, `Basic uploads are limited to ${start.maxBytes} bytes; use tus.`);
      parts.push({ PartNumber: parts.length + 1, ETag: await putPart(url, part) });
    };

    for await (const chunk of field.chunks) {
      total += chunk.length;
      if (total > start.maxBytes) {
        throw new HttpError(413, `Basic uploads are limited to ${start.maxBytes} bytes; use tus.`);
      }
      pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes >= start.partSize) await flush(start.partSize);
    }
    if (pendingBytes > 0) await flush(pendingBytes);
    if (total === 0) throw new HttpError(400, 'The file is empty.');

    const done = await api<{ video: unknown }>(env, 'POST', `/basic/${start.uid}/complete`, {
      lockToken: start.lockToken,
      parts,
      filename: field.filename,
    });
    return done.video;
  } catch (err) {
    await api(env, 'POST', `/basic/${start.uid}/abort`, {
      lockToken: start.lockToken,
      discard: start.discardOnFailure,
    }).catch(() => {});
    throw err;
  }
}

/** POST /upload/:uid: the one-time URL from direct_upload. */
async function handleOneTimeUpload(request: Request, env: Env, uid: string) {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST')
    return json(failure(new HttpError(405, 'Use POST.')), 405, CORS_HEADERS);
  try {
    const start = await api<BasicStart>(env, 'POST', '/basic/start', { uid });
    await streamFormUpload(request, env, start);
    return json(envelope(null), 200, CORS_HEADERS);
  } catch (err) {
    const e = toHttpError(err);
    return json(failure(e), e.status, CORS_HEADERS);
  }
}

/** POST /client/v4/accounts/:id/stream with a file and an API token. */
async function handleApiUpload(request: Request, env: Env, accountId: string) {
  try {
    const start = await api<BasicStart>(env, 'POST', '/basic/start', {
      accountId,
      authorization: request.headers.get('authorization') ?? undefined,
      ip: request.headers.get('cf-connecting-ip') ?? undefined,
    });
    return json(envelope(await streamFormUpload(request, env, start)));
  } catch (err) {
    const e = toHttpError(err);
    return json(failure(e), e.status);
  }
}

/* ─── Everything else: the API server ────────────────────────── */

function passThrough(request: Request, env: Env, url: URL) {
  const headers = new Headers(request.headers);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  return fetch(`${env.API_ORIGIN}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const tus = /^\/upload\/tus\/([0-9a-f]{32})\/?$/.exec(path);
    if (tus) return handleTus(request, env, tus[1]!);

    const oneTime = /^\/upload\/([0-9a-f]{32})\/?$/.exec(path);
    if (oneTime) return handleOneTimeUpload(request, env, oneTime[1]!);

    const create = /^\/client\/v4\/accounts\/([^/]+)\/stream\/?$/.exec(path);
    if (
      create &&
      request.method === 'POST' &&
      !request.headers.has('tus-resumable') &&
      boundaryOf(request.headers.get('content-type'))
    ) {
      return handleApiUpload(request, env, decodeURIComponent(create[1]!));
    }

    if (path.startsWith('/client/v4/')) return passThrough(request, env, url);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
