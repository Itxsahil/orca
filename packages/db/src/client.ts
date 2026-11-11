import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export function createDb(databaseUrl: string) {
  return drizzle({
    connection: { connectionString: databaseUrl },
    schema,
    casing: 'snake_case',
  });
}

export type Db = ReturnType<typeof createDb>;
