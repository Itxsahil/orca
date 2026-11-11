import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/env';

loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
