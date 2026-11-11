# Rules

How code is organised in this repo. Read this before your first change; follow it in every PR.

## Web app (`apps/web`)

### Structure

```
apps/web/src/
├── main.tsx                 entry: providers + router
├── styles.css
├── routes/                  ONE FILE = ONE URL (the page lives here)
│   ├── __root.tsx             error page, 404
│   ├── index.tsx              "/" → sends you to the right page
│   ├── _public.tsx            layout for logged-out pages
│   ├── _public/
│   │   ├── login.tsx              /login
│   │   ├── setup.tsx              /setup
│   │   └── invite.$token.tsx      /invite/:token
│   ├── _authenticated.tsx     layout + "must be logged in"
│   └── _authenticated/
│       ├── admin.tsx              /admin
│       └── home.tsx               /home
├── components/
│   ├── ui/                  shadcn components: added with `npx shadcn add`, never edited by hand
│   └── *.tsx                shared app components (mode-toggle, theme-provider, …)
├── lib/                     everything that isn't UI
│   ├── orpc.ts                API client
│   ├── auth.ts                guards + useSignedIn
│   ├── errors.ts
│   └── utils.ts
└── routeTree.gen.ts         generated, don't touch
```

### Rules

1. **A page is one file in `routes/`.** Its file path is its URL, and the page component lives in
   that file.
2. **Page-only pieces stay in the page file.** When the file grows past ~200 lines, move them to
   `routes/<page>/-components/`. The `-` prefix tells the router "this is not a page".
3. **Shared UI goes in `components/`.** shadcn components go in `components/ui/` and are added
   only with the CLI (`npx shadcn add <name>`), never written or edited by hand.
4. **Anything that is not UI goes in `lib/`.**
5. **All API calls go through `orpc`:** `orpc.x.queryOptions()` / `orpc.x.mutationOptions()`.
   Never call `fetch()` directly.
6. **Access rules go in a layout's `beforeLoad`**, never inside a page component.
7. **Naming:** file names in `kebab-case`, components in `PascalCase`, imports always via `@/`.

> **Status:** the code does not fully follow this structure yet. `src/pages/`, the `_app` /
> `_guest` layouts and the loose `src/orpc.ts` / `src/errors.ts` are still the old layout and
> will be moved to match. New code follows the rules above.
