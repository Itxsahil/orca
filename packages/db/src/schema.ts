import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  real,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Auth model
 *
 *   users ──< memberships >── organizations
 *                  │
 *               role ('owner' for now; add 'admin' / 'member' here later)
 *
 *   invitations: single-use links that create a user + membership
 *   sessions live in Redis (see apps/api/src/auth/session.ts), not in Postgres
 */

/** Roles inside an organization. Extend this list when members/admins are added. */
export const orgRole = pgEnum('org_role', ['owner']);

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Stored trimmed and lower-cased. */
    email: text().notNull().unique(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    isPlatformAdmin: boolean().notNull().default(false),
    /** Set when the platform admin bans this user: they are logged out and cannot log in. */
    bannedAt: timestamp({ withTimezone: true }),
    banReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one platform admin: makes the first-run setup race-proof.
    uniqueIndex('users_single_platform_admin')
      .on(t.isPlatformAdmin)
      .where(sql`${t.isPlatformAdmin} = true`),
  ],
);

export const organizations = pgTable('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** Set when the platform admin bans the organization: its members are logged out and blocked. */
  bannedAt: timestamp({ withTimezone: true }),
  banReason: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: orgRole().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] }), index().on(t.orgId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stored trimmed and lower-cased; the account created from this invite uses it. */
    email: text().notNull(),
    role: orgRole().notNull(),
    /** SHA-256 of the token in the link. The token itself is never stored. */
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId)],
);

/* ─── Videos (shaped like Cloudflare Stream's video object) ───── */

/** Cloudflare Stream's states, so Stream clients see the same lifecycle. */
export const videoState = pgEnum('video_state', [
  'pendingupload',
  'downloading',
  'queued',
  'inprogress',
  'ready',
  'error',
]);

export interface UploadedPart {
  PartNumber: number;
  ETag: string;
}

export const videos = pgTable(
  'videos',
  {
    /** 32 hex characters, like a Stream uid. */
    uid: text().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    state: videoState().notNull().default('pendingupload'),
    pctComplete: real(),
    errorReasonCode: text(),
    errorReasonText: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    creator: text(),
    /** Stream calls this requireSignedURLs. */
    requireSignedUrls: boolean().notNull().default(false),
    allowedOrigins: jsonb().$type<string[]>().notNull().default([]),
    thumbnailTimestampPct: real().notNull().default(0),
    scheduledDeletion: timestamp({ withTimezone: true }),
    /** Limits set when a one-time upload URL is created (direct creator uploads). */
    maxDurationSeconds: integer(),
    maxSizeBytes: bigint({ mode: 'number' }),
    /** A one-time upload URL stops working after this. */
    uploadExpiry: timestamp({ withTimezone: true }),

    /* Upload bookkeeping (not part of the Stream object). */
    /** Total size announced by the client (tus Upload-Length), then the stored size. */
    size: bigint({ mode: 'number' }),
    /** Bytes received so far (tus Upload-Offset). */
    uploadOffset: bigint({ mode: 'number' }).notNull().default(0),
    /** R2 multipart upload id while uploading. */
    uploadId: text(),
    /** Every chunk except the last must be this size (R2 multipart + Stream's tus rules). */
    partSize: integer(),
    parts: jsonb().$type<UploadedPart[]>().notNull().default([]),
    sourceKey: text(),
    uploaded: timestamp({ withTimezone: true }),

    /* Filled by the encoder (phase 2). */
    duration: real(),
    width: integer(),
    height: integer(),
    readyToStreamAt: timestamp({ withTimezone: true }),
    /** Encoding jobs: an encoder owns a video while its lease runs; a crashed one's lease expires. */
    encodeLeaseUntil: timestamp({ withTimezone: true }),
    encodeAttempts: integer().notNull().default(0),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    created: timestamp({ withTimezone: true }).notNull().defaultNow(),
    modified: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.orgId, t.created), index().on(t.state, t.uploaded)],
);

/** Org API tokens for the Stream-compatible API (Authorization: Bearer <token>). */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** SHA-256 of the token. The token is shown once and never stored. */
    tokenHash: text().notNull().unique(),
    /** First characters, to recognise a token in lists. */
    prefix: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
export type Video = typeof videos.$inferSelect;
export type VideoState = (typeof videoState.enumValues)[number];
export type ApiToken = typeof apiTokens.$inferSelect;
