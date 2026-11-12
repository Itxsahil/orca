# Video Platform

Monorepo starter: **Vite + React** · **Express + oRPC** · **Drizzle + Postgres**, with end-to-end types.

```
apps/
  web/            Vite + React + TanStack Query, typed oRPC client
  api/            Express 5 + oRPC server (served under /rpc)
  upload-worker/  Cloudflare Worker: Stream-compatible API host, moves video bytes into R2
  encoder/        ffmpeg encoder: turns uploads into HLS (runs on your own servers)
packages/
  contract/   oRPC contract (zod), shared by web and api
  db/         Drizzle schema, client and migrations
```

## Getting started

```bash
cp .env.example .env
cp apps/upload-worker/.dev.vars.example apps/upload-worker/.dev.vars
docker compose up -d        # Postgres :5432, Redis :6379, S3 (SeaweedFS, stands in for R2) :8333
npm install
npm run db:migrate
npm run storage:setup       # creates the two buckets (idempotent)
npm run dev                 # api :3000, web :5173 (proxies /rpc), upload Worker :8787, encoder
                            # (the encoder needs ffmpeg installed locally)
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

**Banning (platform admin):** in `/admin` the sidebar has **Organizations** and **Clients**.
Banning a client logs them out everywhere and blocks login ("This account has been suspended").
Banning an organization does the same for its members, and stops its pending invites and new links.
Every request re-checks bans, and unbanning restores access. The platform admin cannot be banned.

**Invite emails:** when `RESEND_API_KEY` is set, creating an organization (or a new link) also
emails the invite, sent from `EMAIL_FROM` through Resend's HTTP API (`apps/api/src/email/`). The
template follows the web theme, light or dark per the reader's mail app. Without a key, or if
sending fails, the invite is still created and `/admin` shows why, with the link to copy.
Resend's test sender `onboarding@resend.dev` can only email your own Resend address: verify a
domain to email clients.

**Settings:** `SIGNUP_MODE=invite` (default) or `closed` (no new accounts, even with a link),
`SESSION_TTL_DAYS` (30), `INVITE_TTL_DAYS` (7), `COOKIE_SECURE` (on in production), `TRUST_PROXY`.

**How it is secured**

- Passwords: scrypt (N=2^15, r=8, p=1) with a random salt, compared in constant time.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed and
  `Secure` in production). Only its SHA-256 is stored, in **Redis** (`session:<hash>` with a sliding
  expiry, plus `user-sessions:<user id>` so a user can be logged out everywhere at once).
- Invite links: random 256-bit token, only its hash stored, single-use, expire, revocable; issuing
  a new link for the same email revokes the previous one.
- CSRF: the API requires the `x-csrf-token` header that the web client sends.
- Login: same error and similar timing for unknown email vs wrong password; rate limits are kept in
  Redis, so they hold across several API instances.
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

## Video uploads (Cloudflare Stream-compatible)

Videos are stored in **private** Cloudflare R2 (no public bucket), in two buckets shared by all
organizations: `R2_SOURCE_BUCKET` (originals, `<orgId>/<uid>/original`) and `R2_DELIVERY_BUCKET`
(encoded output, from phase 2).

The API speaks Cloudflare Stream's upload API, so Stream code switches over by changing three
values (shown on the dashboard's **API keys** page):

| Cloudflare Stream                      | Here                             |
| -------------------------------------- | -------------------------------- |
| `https://api.cloudflare.com/client/v4` | `${STREAM_PUBLIC_URL}/client/v4` |
| Cloudflare account ID                  | the organization ID              |
| Cloudflare API token                   | an API key from the dashboard    |

Supported, with Stream's request and response shapes:

- `POST /accounts/:id/stream`: basic upload (`multipart/form-data`, field `file`, up to 200 MB),
  or tus upload creation when `Tus-Resumable` is sent (also `?direct_user=true`). Returns
  `Location` and `stream-media-id`. `Upload-Metadata` keys: `name`, `requiresignedurls`,
  `allowedorigins`, `thumbnailtimestamppct`, `scheduleddeletion`, `maxDurationSeconds`, `expiry`;
  other keys go into `meta`. `Upload-Creator` sets `creator`.
- `POST /accounts/:id/stream/direct_upload`: one-time basic upload URL (default expiry 30 min).
- `GET /accounts/:id/stream` (`creator`, `status`, `search`, `start`, `end`, `asc`, `limit`,
  `include_counts`), `GET|POST|DELETE /accounts/:id/stream/:uid`.

How uploads work: video bytes never pass through the API server.

```
client ──tus PATCH / form POST──▶ upload Worker ──PUT (presigned part URL)──▶ R2
                                       │
                                       └─ small JSON calls ─▶ API /internal/uploads
                                          (may I? → presigned URL; stored → record it)
```

- The Worker (`apps/upload-worker`) serves `STREAM_PUBLIC_URL`: `/client/v4/*` (requests
  without video bytes are passed on to the API) and `/upload/*` (tus and one-time URLs).
- For each tus chunk the API checks Stream's chunk rules (at least 5 MiB, at most 200 MiB, a
  multiple of 256 KiB, all equal except the last) and returns a presigned URL for exactly one R2
  multipart part. The Worker streams the chunk there and reports the part's ETag; the API records
  it only if the offset still matches, so an interrupted or duplicated chunk changes nothing.
  The last chunk completes the object; its size is checked and the video moves to `queued`.
- Basic uploads: the Worker reads the form data as a stream and stores it in 8 MiB parts.
- The Worker holds no R2 keys; it authenticates to the API with `UPLOAD_WORKER_SECRET`.
- Abandoned uploads are removed hourly (expired before starting, or idle for 7 days), and the
  source bucket aborts stale multipart uploads after 2 days.

Deploying the Worker: set `API_ORIGIN` in `apps/upload-worker/wrangler.toml` to a hostname that
reaches the API server directly (not routed through the Worker), add a route or custom domain,
`npx wrangler secret put UPLOAD_WORKER_SECRET` (same value as the API's), then
`npm run worker:deploy`. Use the Workers Paid plan: uploads need more CPU time than the free
plan's 10 ms per request.

Limits on Cloudflare: a request to a Worker can carry at most 100 MB on the Free and Pro plans
of the Worker's domain (200 MB on Business, more on Enterprise). tus chunks of 50 MiB (Stream's
recommendation, used by the dashboard) are fine; chunks or form uploads above 100 MB need a
bigger plan.

## Encoding (apps/encoder)

Uploaded videos are `queued`; an encoder turns them into HLS and marks them `ready`.

```
queued ─▶ encoder claims it ─▶ download original from R2 ─▶ ffprobe ─▶ ffmpeg ─▶ upload to delivery bucket ─▶ ready
```

- **Any input ffmpeg can read** (H.264, HEVC incl. 10-bit, VP9, AV1, ProRes, MPEG-2, GIF, …;
  phone rotation is applied). Output: H.264 + AAC, HLS with fMP4 segments of 6 s, keyframes every
  2 s, in `<orgId>/<uid>/hls/master.m3u8` (+ `v0/`, `v1/`, …) and
  `<orgId>/<uid>/thumbnails/thumbnail.jpg` in the delivery bucket.
- **Ladder** by the short side, never upscaled: 1080p, 720p, 480p, 360p, 240p (portrait videos
  get the same rungs). Inputs smaller than 240p keep their size; above 60 fps is capped at 60.
- **Stream's states and errors:** `inprogress` with `pctComplete`, then `ready` with `duration`
  and `input` size, or `error` with `ERR_NON_VIDEO`, `ERR_MALFORMED_VIDEO`,
  `ERR_DURATION_TOO_SHORT`, `ERR_DURATION_EXCEED_CONSTRAINT` (`maxDurationSeconds`) or
  `ERR_UNKNOWN`.
- **Queue = the `videos` table**, claimed with `FOR UPDATE SKIP LOCKED`: run as many encoders on
  as many servers as you like, each video is encoded once. A 2-minute lease is renewed while
  working; if an encoder crashes, another takes the video over when the lease runs out. Failures
  are retried (30 s, then 60 s) up to `ENCODER_MAX_ATTEMPTS`. `SIGTERM` puts unfinished videos
  back in the queue without counting the attempt. Deleting a video while it encodes stops the job
  and removes its output.

Running on a VPS (Docker):

```bash
docker build -f apps/encoder/Dockerfile -t video-encoder .
docker run -d --name encoder --restart unless-stopped --env-file .env video-encoder
```

The encoder needs `DATABASE_URL` and the `R2_*` settings; it does not talk to the API. Give it
disk for the largest original plus its encoded output. Stop it with `docker stop` (SIGTERM), not
`kill -9` on the node process alone: that would leave ffmpeg running.

Not yet: playback and signed URLs (phase 3), upload from URL, watermarks, webhooks, 4K output.
webhooks. Videos stay `queued` until the encoder exists.

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
