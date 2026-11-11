import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';
import { loadEnv } from './env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
if (!existsSync(path.join(migrationsFolder, 'meta', '_journal.json'))) {
  console.log('No migrations yet. Add tables to src/schema.ts and run `npm run db:generate`.');
  process.exit(0);
}

const db = createDb(url);
await migrate(db, { migrationsFolder });
console.log('Migrations applied');
await db.$client.end();
