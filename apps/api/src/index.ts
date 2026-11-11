import express from 'express';
import cors from 'cors';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import { createDb } from '@repo/db';
import { env } from './env';
import { router } from './router';
import type { Context } from './context';

const db = createDb(env.DATABASE_URL);
const context: Context = { db };

const rpcHandler = new RPCHandler(router, {
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
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// oRPC reads the request body itself: keep body parsers (express.json) off this path.
app.use('/rpc{/*path}', async (req, res, next) => {
  const { matched } = await rpcHandler.handle(req, res, { prefix: '/rpc', context });
  if (!matched) next();
});

// Plain routes for things that should not go through RPC (webhooks, uptime checks, ...).
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  await db.$client.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
