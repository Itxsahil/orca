import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
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

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
