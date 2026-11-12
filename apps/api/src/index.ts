import express from 'express';
import cors from 'cors';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import {
  RequestHeadersPlugin,
  ResponseHeadersPlugin,
  SimpleCsrfProtectionHandlerPlugin,
} from '@orpc/server/plugins';
import { createDb } from '@repo/db';
import { env } from './env';
import { router } from './router';
import { createRedis } from './redis';

const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

const rpcHandler = new RPCHandler(router, {
  plugins: [
    new RequestHeadersPlugin(), // context.reqHeaders: read the session cookie
    new ResponseHeadersPlugin(), // context.resHeaders: set the session cookie
    // Requires the x-csrf-token header that the web client sends. Other sites cannot
    // add custom headers to cross-origin requests without passing CORS.
    new SimpleCsrfProtectionHandlerPlugin(),
  ],
  interceptors: [
    onError((error) => {
      // Expected errors (4xx) are returned to the client; log the rest.
      const status = (error as { status?: number }).status;
      if (!status || status >= 500) console.error('[rpc]', error);
    }),
  ],
});

const app = express();
app.disable('x-powered-by');
if (env.TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
}
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// oRPC reads the request body itself: keep body parsers (express.json) off this path.
app.use('/rpc{/*path}', async (req, res, next) => {
  const { matched } = await rpcHandler.handle(req, res, {
    prefix: '/rpc',
    context: { db, redis, ip: req.ip ?? 'unknown' },
  });
  if (!matched) next();
});

// Plain routes for things that should not go through RPC (webhooks, uptime checks, ...).
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
  if (!env.PLATFORM_ADMIN_EMAIL) {
    console.warn('[api] PLATFORM_ADMIN_EMAIL is not set: the first-run setup is disabled.');
  }
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  await redis.quit().catch(() => {});
  await db.$client.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
