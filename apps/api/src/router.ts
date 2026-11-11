import { implement, ORPCError } from '@orpc/server';
import { contract, type Me } from '@repo/contract';
import {
  and,
  desc,
  eq,
  inArray,
  invitations,
  isNull,
  memberships,
  organizations,
  sql,
  users,
  type Db,
  type Invitation,
  type User,
} from '@repo/db';
import { env } from './env';
import type { Context } from './context';
import { getDummyHash, hashPassword, verifyPassword } from './auth/password';
import { rateLimit } from './auth/rate-limit';
import { endSession, getSessionUser, startSession } from './auth/session';
import { hashToken, newToken } from './auth/tokens';
import { renderInviteEmail } from './email/invite-email';
import { sendEmail } from './email/send';

const os = implement(contract).$context<Context>();

/** A database handle or an open transaction. */
type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ─── Middleware ─────────────────────────────────────────────── */

/** Requires a logged-in user; adds `context.user`. */
const authed = os.middleware(async ({ context, next }) => {
  const user = await getSessionUser(context);
  if (!user) throw new ORPCError('UNAUTHORIZED', { message: 'Please log in.' });
  return next({ context: { user } });
});

/** Requires the platform admin. */
const platformAdmin = os.middleware(async ({ context, next }) => {
  const user = await getSessionUser(context);
  if (!user) throw new ORPCError('UNAUTHORIZED', { message: 'Please log in.' });
  if (!user.isPlatformAdmin) throw new ORPCError('FORBIDDEN', { message: 'Platform admins only.' });
  return next({ context: { user } });
});

/* ─── Helpers ────────────────────────────────────────────────── */

async function loadMe(db: Db, user: User): Promise<Me> {
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, user.id))
    .orderBy(organizations.name);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    orgs,
  };
}

function inviteStatus(inv: Invitation, now = new Date()) {
  if (inv.acceptedAt) return 'accepted' as const;
  if (inv.revokedAt) return 'revoked' as const;
  if (inv.expiresAt <= now) return 'expired' as const;
  return 'pending' as const;
}

const INVITE_PROBLEMS = {
  accepted: 'This invite link has already been used. Log in instead.',
  revoked: 'This invite link was revoked. Ask for a new one.',
  expired: 'This invite link has expired. Ask for a new one.',
} as const;

function assertSignupsOpen() {
  if (env.SIGNUP_MODE === 'closed') {
    throw new ORPCError('FORBIDDEN', { message: 'New accounts are currently disabled.' });
  }
}

async function adminExists(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isPlatformAdmin, true))
    .limit(1);
  return !!row;
}

/** Creates an owner invite for an org and returns the one-time link. */
async function createInvite(db: DbOrTx, orgId: string, email: string, invitedBy: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + env.INVITE_TTL_DAYS * DAY_MS);
  // Only one live link per org + email: older pending ones stop working.
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.orgId, orgId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  const [invite] = await db
    .insert(invitations)
    .values({ orgId, email, role: 'owner', tokenHash: hashToken(token), expiresAt, invitedBy })
    .returning({ id: invitations.id });
  return { inviteId: invite!.id, inviteUrl: `${env.APP_URL}/invite/${token}`, expiresAt };
}

/** Emails an invite link. Never throws: a failed email still leaves a working, copyable link. */
async function emailInvite(input: {
  to: string;
  orgName: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}) {
  const result = await sendEmail(renderInviteEmail(input));
  return result.sent
    ? { emailSent: true, emailError: null }
    : { emailSent: false, emailError: result.error };
}

const isUniqueViolation = (err: unknown) =>
  (err as { cause?: { code?: string } })?.cause?.code === '23505' ||
  (err as { code?: string })?.code === '23505';

/* ─── Procedures ─────────────────────────────────────────────── */

export const router = os.router({
  health: os.health.handler(async ({ context }) => {
    let db = false;
    try {
      await context.db.execute(sql`select 1`);
      db = true;
    } catch {
      db = false;
    }
    return { ok: true as const, db, time: new Date() };
  }),

  auth: {
    status: os.auth.status.handler(async ({ context }) => ({
      setupRequired: !(await adminExists(context.db)),
    })),

    setup: os.auth.setup.handler(async ({ input, context }) => {
      rateLimit(`setup:${context.ip}`, 5, MINUTE);
      assertSignupsOpen();
      if (!env.PLATFORM_ADMIN_EMAIL) {
        throw new ORPCError('FORBIDDEN', { message: 'PLATFORM_ADMIN_EMAIL is not configured.' });
      }
      if (await adminExists(context.db)) {
        throw new ORPCError('FORBIDDEN', { message: 'Setup is already complete. Log in instead.' });
      }
      if (input.email !== env.PLATFORM_ADMIN_EMAIL) {
        throw new ORPCError('FORBIDDEN', {
          message: 'This email is not allowed to set up the platform.',
        });
      }

      let user: User;
      try {
        [user] = (await context.db
          .insert(users)
          .values({
            email: input.email,
            name: input.name,
            passwordHash: await hashPassword(input.password),
            isPlatformAdmin: true,
          })
          .returning()) as [User];
      } catch (err) {
        // Two setup requests at once: the unique index lets only one through.
        if (isUniqueViolation(err)) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Setup is already complete. Log in instead.',
          });
        }
        throw err;
      }
      await startSession(context, user.id);
      return loadMe(context.db, user);
    }),

    login: os.auth.login.handler(async ({ input, context }) => {
      rateLimit(`login:${context.ip}:${input.email}`, 5, MINUTE);
      rateLimit(`login-ip:${context.ip}`, 30, MINUTE);

      const [user] = await context.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      // Always run one hash check, so unknown emails are not faster to reject.
      const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !ok) {
        throw new ORPCError('UNAUTHORIZED', { message: 'Invalid email or password.' });
      }
      await startSession(context, user.id);
      return loadMe(context.db, user);
    }),

    logout: os.auth.logout.handler(async ({ context }) => {
      await endSession(context);
      return { ok: true as const };
    }),

    me: os.auth.me.handler(async ({ context }) => {
      const user = await getSessionUser(context);
      return user ? loadMe(context.db, user) : null;
    }),
  },

  invites: {
    preview: os.invites.preview.handler(async ({ input, context }) => {
      rateLimit(`invite-preview:${context.ip}`, 30, MINUTE);
      const [row] = await context.db
        .select({ invite: invitations, orgName: organizations.name })
        .from(invitations)
        .innerJoin(organizations, eq(organizations.id, invitations.orgId))
        .where(eq(invitations.tokenHash, hashToken(input.token)))
        .limit(1);
      if (!row) throw new ORPCError('NOT_FOUND', { message: 'This invite link is not valid.' });
      const status = inviteStatus(row.invite);
      if (status !== 'pending')
        throw new ORPCError('NOT_FOUND', { message: INVITE_PROBLEMS[status] });
      return { orgName: row.orgName, email: row.invite.email, role: row.invite.role };
    }),

    accept: os.invites.accept.handler(async ({ input, context }) => {
      rateLimit(`invite-accept:${context.ip}`, 10, MINUTE);
      assertSignupsOpen();
      const passwordHash = await hashPassword(input.password);

      const user = await context.db.transaction(async (tx) => {
        // Lock the invite so two submissions of the same link cannot both succeed.
        const [invite] = await tx
          .select()
          .from(invitations)
          .where(eq(invitations.tokenHash, hashToken(input.token)))
          .for('update')
          .limit(1);
        if (!invite)
          throw new ORPCError('NOT_FOUND', { message: 'This invite link is not valid.' });
        const status = inviteStatus(invite);
        if (status !== 'pending')
          throw new ORPCError('NOT_FOUND', { message: INVITE_PROBLEMS[status] });

        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, invite.email))
          .limit(1);
        if (existing) {
          // Joining an org with an existing account comes later (members/admins).
          throw new ORPCError('CONFLICT', {
            message: 'An account with this email already exists. Log in instead.',
          });
        }

        const [created] = await tx
          .insert(users)
          .values({ email: invite.email, name: input.name, passwordHash })
          .returning();
        await tx
          .insert(memberships)
          .values({ userId: created!.id, orgId: invite.orgId, role: invite.role });
        await tx
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invite.id));
        return created!;
      });

      await startSession(context, user.id);
      return loadMe(context.db, user);
    }),
  },

  admin: {
    orgs: {
      list: os.admin.orgs.list.use(platformAdmin).handler(async ({ context }) => {
        const orgs = await context.db
          .select()
          .from(organizations)
          .orderBy(desc(organizations.createdAt));
        if (orgs.length === 0) return [];
        const orgIds = orgs.map((o) => o.id);

        const owners = await context.db
          .select({ orgId: memberships.orgId, id: users.id, name: users.name, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(inArray(memberships.orgId, orgIds), eq(memberships.role, 'owner')));
        const invites = await context.db
          .select()
          .from(invitations)
          .where(inArray(invitations.orgId, orgIds))
          .orderBy(desc(invitations.createdAt));

        const now = new Date();
        return orgs.map((org) => ({
          id: org.id,
          name: org.name,
          createdAt: org.createdAt,
          owners: owners.filter((o) => o.orgId === org.id).map(({ orgId: _, ...o }) => o),
          invites: invites
            .filter((i) => i.orgId === org.id)
            .map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role,
              status: inviteStatus(i, now),
              expiresAt: i.expiresAt,
              createdAt: i.createdAt,
            })),
        }));
      }),

      create: os.admin.orgs.create.use(platformAdmin).handler(async ({ input, context }) => {
        const created = await context.db.transaction(async (tx) => {
          const [org] = await tx.insert(organizations).values({ name: input.name }).returning();
          const invite = await createInvite(tx, org!.id, input.ownerEmail, context.user.id);
          return { orgId: org!.id, ...invite };
        });
        // Only after the transaction committed: never email a link that was rolled back.
        const email = await emailInvite({
          to: input.ownerEmail,
          orgName: input.name,
          inviterName: context.user.name,
          inviteUrl: created.inviteUrl,
          expiresAt: created.expiresAt,
        });
        return { ...created, ...email };
      }),
    },

    invites: {
      create: os.admin.invites.create.use(platformAdmin).handler(async ({ input, context }) => {
        const [org] = await context.db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, input.orgId))
          .limit(1);
        if (!org) throw new ORPCError('NOT_FOUND', { message: 'Organization not found.' });
        const invite = await createInvite(context.db, org.id, input.email, context.user.id);
        const email = await emailInvite({
          to: input.email,
          orgName: org.name,
          inviterName: context.user.name,
          inviteUrl: invite.inviteUrl,
          expiresAt: invite.expiresAt,
        });
        return { ...invite, ...email };
      }),

      revoke: os.admin.invites.revoke.use(platformAdmin).handler(async ({ input, context }) => {
        const [invite] = await context.db
          .select()
          .from(invitations)
          .where(eq(invitations.id, input.inviteId))
          .limit(1);
        if (!invite) throw new ORPCError('NOT_FOUND', { message: 'Invite not found.' });
        if (invite.acceptedAt)
          throw new ORPCError('CONFLICT', { message: 'This invite was already accepted.' });
        if (!invite.revokedAt) {
          await context.db
            .update(invitations)
            .set({ revokedAt: new Date() })
            .where(eq(invitations.id, invite.id));
        }
        return { ok: true as const };
      }),
    },
  },
});

/** For organization-scoped procedures (coming with org features). */
export { authed };
export type Router = typeof router;
