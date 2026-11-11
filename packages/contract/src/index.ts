import { oc } from '@orpc/contract';
import { z } from 'zod';

/*
 * The API contract, shared by the server (apps/api) and the client (apps/web).
 * Add procedures here; both sides get type errors until they match.
 */
export const contract = {
  health: oc.output(z.object({ ok: z.literal(true), db: z.boolean(), time: z.date() })),
};

export type Contract = typeof contract;
