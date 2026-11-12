import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { loadEnv } from '@repo/db';

loadEnv();

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  R2_ENDPOINT: z.url(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_REGION: z.string().default('auto'),
  R2_SOURCE_BUCKET: z.string().default('videos-source'),
  R2_DELIVERY_BUCKET: z.string().default('videos-delivery'),

  /** Videos encoded at the same time by this process. ffmpeg already uses every core. */
  ENCODER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  /** Scratch space: the original and the encoded output live here while a job runs. */
  ENCODER_WORK_DIR: z.string().default(path.join(os.tmpdir(), 'video-encoder')),
  /** x264 preset: faster = less CPU, larger files. */
  ENCODER_PRESET: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
    .default('veryfast'),
  /** A video that failed this many times is marked as an error. */
  ENCODER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  /** Wait before the first retry of a failed video; doubles for each further retry. */
  ENCODER_RETRY_DELAY_SECONDS: z.coerce.number().min(0).default(30),
  /** How often an idle encoder looks for work, in milliseconds. */
  ENCODER_POLL_MS: z.coerce.number().int().min(250).default(3000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[encoder] invalid environment:');
  for (const issue of parsed.error.issues)
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
export const env = parsed.data;
