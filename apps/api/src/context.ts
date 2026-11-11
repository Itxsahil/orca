import type { Db } from '@repo/db';

/** Everything a procedure handler can use. */
export interface Context {
  db: Db;
}
