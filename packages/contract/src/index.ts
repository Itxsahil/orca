import { oc } from '@orpc/contract';
import { z } from 'zod';

/*
 * The API contract, shared by the server (apps/api) and the client (apps/web).
 * Add procedures here; both sides get type errors until they match.
 */

// Trim and lower-case first, then validate (z.email() alone would reject pasted spaces).
const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const Password = z.string().min(8, 'Use at least 8 characters').max(128);
const Name = z.string().trim().min(1).max(100);

export const OrgRoleSchema = z.enum(['owner']);

export const MeSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  isPlatformAdmin: z.boolean(),
  orgs: z.array(z.object({ id: z.uuid(), name: z.string(), role: OrgRoleSchema })),
});
export type Me = z.infer<typeof MeSchema>;

export const InviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: OrgRoleSchema,
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.date(),
  createdAt: z.date(),
});

const BanReason = z.string().trim().max(500).optional();

export const OrgSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.date(),
  bannedAt: z.date().nullable(),
  banReason: z.string().nullable(),
  owners: z.array(
    z.object({ id: z.uuid(), name: z.string(), email: z.string(), bannedAt: z.date().nullable() }),
  ),
  invites: z.array(InviteSchema),
});
export type OrgSummary = z.infer<typeof OrgSummarySchema>;

/** A client: any user who is not the platform admin. */
export const ClientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  createdAt: z.date(),
  bannedAt: z.date().nullable(),
  banReason: z.string().nullable(),
  orgs: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: OrgRoleSchema,
      bannedAt: z.date().nullable(),
    }),
  ),
});
export type Client = z.infer<typeof ClientSchema>;

const Ok = z.object({ ok: z.literal(true) });

/** Returned whenever an invite is created. The link is shown once: only its hash is stored. */
export const CreatedInviteSchema = z.object({
  inviteId: z.uuid(),
  inviteUrl: z.string(),
  expiresAt: z.date(),
  /** Whether the invite email went out. The link works either way. */
  emailSent: z.boolean(),
  /** Why the email was not sent (not configured, provider error), when emailSent is false. */
  emailError: z.string().nullable(),
});

export const contract = {
  health: oc.output(
    z.object({ ok: z.literal(true), db: z.boolean(), redis: z.boolean(), time: z.date() }),
  ),

  auth: {
    /** Public. Tells the web app whether the first-run setup page should be shown. */
    status: oc.output(z.object({ setupRequired: z.boolean() })),
    /** Public. Creates the platform admin; only for PLATFORM_ADMIN_EMAIL, only once. */
    setup: oc.input(z.object({ email: Email, name: Name, password: Password })).output(MeSchema),
    login: oc
      .input(z.object({ email: Email, password: z.string().min(1).max(128) }))
      .output(MeSchema),
    logout: oc.output(z.object({ ok: z.literal(true) })),
    /** Public. The current user, or null when not logged in. */
    me: oc.output(MeSchema.nullable()),
  },

  invites: {
    /** Public. What the invite page shows before the user accepts. */
    preview: oc
      .input(z.object({ token: z.string().min(1).max(200) }))
      .output(z.object({ orgName: z.string(), email: z.string(), role: OrgRoleSchema })),
    /** Public. Creates the account + membership from a valid invite and logs the user in. */
    accept: oc
      .input(z.object({ token: z.string().min(1).max(200), name: Name, password: Password }))
      .output(MeSchema),
  },

  admin: {
    orgs: {
      list: oc.output(z.array(OrgSummarySchema)),
      /** Creates an organization and an owner invite for it. */
      create: oc
        .input(z.object({ name: Name, ownerEmail: Email }))
        .output(CreatedInviteSchema.extend({ orgId: z.uuid() })),
      /** Suspends the organization: its members are logged out and blocked. */
      ban: oc.input(z.object({ orgId: z.uuid(), reason: BanReason })).output(Ok),
      unban: oc.input(z.object({ orgId: z.uuid() })).output(Ok),
    },
    users: {
      /** Every client (everyone except the platform admin). */
      list: oc.output(z.array(ClientSchema)),
      /** Suspends the user: logged out everywhere, cannot log in. */
      ban: oc.input(z.object({ userId: z.uuid(), reason: BanReason })).output(Ok),
      unban: oc.input(z.object({ userId: z.uuid() })).output(Ok),
    },
    invites: {
      /** New owner invite for an existing organization (e.g. the previous one expired). */
      create: oc.input(z.object({ orgId: z.uuid(), email: Email })).output(CreatedInviteSchema),
      revoke: oc.input(z.object({ inviteId: z.uuid() })).output(Ok),
    },
  },
};

export type Contract = typeof contract;
