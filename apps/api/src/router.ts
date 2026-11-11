import { implement } from '@orpc/server';
import { contract } from '@repo/contract';
import { sql } from '@repo/db';
import type { Context } from './context';

const os = implement(contract).$context<Context>();

export const router = os.router({
  health: os.health.handler(async ({ context }) => {
    let db = false;
    try {
      await context.db.execute(sql`select 1`);
      db = true;
    } catch {
      db = false;
    }
    return { ok: true as const, db, time: new Date() };
  }),
});

export type Router = typeof router;
