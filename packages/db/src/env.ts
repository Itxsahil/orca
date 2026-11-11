import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load the repo-root .env (if present) without overriding real environment variables. */
export function loadEnv(): void {
  const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // No .env file: rely on the real environment.
  }
}
