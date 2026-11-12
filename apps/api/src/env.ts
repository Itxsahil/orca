import { z } from 'zod';
import { loadEnv } from '@repo/db';

loadEnv();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Sessions and rate limits live here (redis:// or rediss://). */
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /** Public URL of the web app; invite links point here. */
  APP_URL: z
    .url()
    .default('http://localhost:5173')
    .transform((v) => v.replace(/\/+$/, '')),
  /** The only email allowed to create the first (platform admin) account. */
  PLATFORM_ADMIN_EMAIL: z
    .email()
    .transform((v) => v.trim().toLowerCase())
    .optional(),
  /** invite: accounts only via invite links (and the first-run setup). closed: no new accounts at all. */
  SIGNUP_MODE: z.enum(['invite', 'closed']).default('invite'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Secure cookies. Defaults to on in production; must be on when served over https. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Express "trust proxy" setting, e.g. 1 behind one reverse proxy, so rate limits see real IPs. */
  TRUST_PROXY: z.string().optional(),

  /** Public URL of this API: Stream-compatible upload URLs and tus Locations point here. */
  API_PUBLIC_URL: z
    .url()
    .default('http://localhost:3000')
    .transform((v) => v.replace(/\/+$/, '')),

  /* ---- Video storage: Cloudflare R2 (any S3-compatible store works for local dev) ---- */
  /** e.g. https://<account id>.r2.cloudflarestorage.com, or http://localhost:8333 for local dev */
  R2_ENDPOINT: z.url(),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_REGION: z.string().default('auto'),
  /** Private bucket for original uploads. */
  R2_SOURCE_BUCKET: z.string().default('videos-source'),
  /** Private bucket for encoded output (HLS, thumbnails). Nothing is public: playback is presigned. */
  R2_DELIVERY_BUCKET: z.string().default('videos-delivery'),
  /** Largest accepted upload. Cloudflare Stream accepts files under 30 GB. */
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 1024 ** 3),

  /** Resend API key. When unset, no emails are sent (invite links can still be copied). */
  RESEND_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** Sender, e.g. "Video Platform <invites@yourdomain.com>" (the domain must be verified in Resend). */
  EMAIL_FROM: z.string().trim().default('Video Platform <onboarding@resend.dev>'),
  /** Resend API base URL. Only change it for testing or an outbound proxy. */
  RESEND_API_URL: z
    .url()
    .default('https://api.resend.com')
    .transform((v) => v.replace(/\/+$/, '')),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
};
