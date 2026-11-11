# Video Platform

Monorepo starter: **Vite + React** · **Express + oRPC** · **Drizzle + Postgres**, with end-to-end types.

```
apps/
  web/        Vite + React + TanStack Query, typed oRPC client
  api/        Express 5 + oRPC server (served under /rpc)
packages/
  contract/   oRPC contract (zod), shared by web and api
  db/         Drizzle schema, client and migrations
```

## Getting started

```bash
cp .env.example .env
docker compose up -d        # Postgres on localhost:5432
npm install
npm run dev                 # api on :3000, web on :5173 (proxies /rpc to the api)
```

Open http://localhost:5173: it calls the `health` procedure and shows whether the API and database are up.

## Auth

Invite-only, email + password, written with Node's built-in `crypto` (no auth library).

**Roles:** one **platform admin** (you) and **organization owners** (clients). Membership roles live in
`memberships.role`; add `admin` / `member` there when needed.

**Flow**

1. Set `PLATFORM_ADMIN_EMAIL`. On first run the app opens `/setup`; only that email can create the
   admin account, and only once.
2. On `/admin`, create an organization with its owner's email. You get a one-time invite link to
   send yourself (no email service needed).
3. The owner opens `/invite/<token>`, picks a name and password, and is logged in as owner.
4. Everyone logs in at `/login`.

**Settings:** `SIGNUP_MODE=invite` (default) or `closed` (no new accounts, even with a link),
`SESSION_TTL_DAYS` (30), `INVITE_TTL_DAYS` (7), `COOKIE_SECURE` (on in production), `TRUST_PROXY`.

**How it is secured**

- Passwords: scrypt (N=2^15, r=8, p=1) with a random salt, compared in constant time.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed and
  `Secure` in production). Only its SHA-256 is stored, in `sessions`.
- Invite links: random 256-bit token, only its hash stored, single-use, expire, revocable; issuing
  a new link for the same email revokes the previous one.
- CSRF: the API requires the `x-csrf-token` header that the web client sends.
- Login: same error and similar timing for unknown email vs wrong password; in-memory rate limits
  (move them to Postgres/Redis when running several API instances).
- Races: one platform admin is enforced by a unique index; accepting an invite locks its row.

In procedures, use the `authed` and `platformAdmin` middleware from `apps/api/src/router.ts`.

## Routing (web)

[TanStack Router](https://tanstack.com/router) with file-based routes in `apps/web/src/routes`.
The Vite plugin regenerates `src/routeTree.gen.ts` whenever a route file changes (don't edit it).

```
routes/
  __root.tsx            error page (API unreachable) and 404
  index.tsx             "/" redirects to /setup, /login, /admin or /home
  _guest.tsx            layout for logged-out pages
    _guest/setup.tsx      first-run admin setup (only while no admin exists)
    _guest/login.tsx
    _guest/invite/$token.tsx
  _app.tsx              layout + guard: must be logged in; gives children `context.me`
    _app/admin.tsx        platform admin only; preloads the org list
    _app/home.tsx
```

Guards live in each route's `beforeLoad` and read auth state from the TanStack Query cache
(`src/lib/auth.ts`). Links and params are typed: `<Link to="/invite/$token" params={{ token }}>`.

## Adding a procedure

1. Describe it in `packages/contract/src/index.ts` (input/output with zod).
2. Implement it in `apps/api/src/router.ts`.
3. Call it from React: `useQuery(orpc.yourProcedure.queryOptions({ input }))`.

TypeScript flags any mismatch between the three.

## Database

1. Add tables to `packages/db/src/schema.ts`.
2. `npm run db:generate -- --name <change-name>` to write a SQL migration to `packages/db/drizzle/`.
3. `npm run db:migrate` to apply it. `npm run db:studio` opens Drizzle Studio.

## Scripts

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | api + web in watch mode                                            |
| `npm run build`     | bundle the api (`apps/api/dist`) and the web app (`apps/web/dist`) |
| `npm run typecheck` | type-check every workspace                                         |
| `npm run format`    | Prettier                                                           |

Production: `node apps/api/dist/index.js` with `DATABASE_URL` set, and serve `apps/web/dist` from any static host (set `VITE_API_URL` at build time if the API is on another origin).
