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
