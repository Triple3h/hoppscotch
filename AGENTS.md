# AGENTS.md

## What this is

**Hoppscotch** — open-source API development ecosystem (REST, GraphQL, WebSocket, SSE, Socket.IO, MQTT client + self-hosted backend, CLI, and Tauri desktop apps). It is a **pnpm monorepo**; all packages live in `packages/*`. `pnpm install` is enforced via `only-allow pnpm` — never use npm/yarn.

## Packages (most relevant)

Note: most frontend packages are npm-scoped — the `pnpm --filter` name differs from the directory name (e.g. dir `packages/hoppscotch-common` is package `@hoppscotch/common`). Unscoped names: `hoppscotch-backend`, `hoppscotch-sh-admin`, `hoppscotch-desktop`, `hoppscotch-agent`.

- `hoppscotch-common` (`@hoppscotch/common`) — **where almost all UI work happens**: components, pages, layouts, composables, `helpers/` (incl. `.graphql` documents), `services/`, `newstore/` state stores, i18n locales (`locales/`). Depended on by web + desktop.
- `hoppscotch-selfhost-web` (`@hoppscotch/selfhost-web`) — thin shell around `hoppscotch-common` (Vue 3 + Vite + Tailwind). Entry: `src/main.ts`.
- `hoppscotch-backend` — NestJS + GraphQL (Apollo) + Prisma/PostgreSQL backend. `src/` is organized per domain (`user-*`, `team-*`, `auth`, `admin`, `mock-server`, …).
- `hoppscotch-cli` (`@hoppscotch/cli`) — CLI runner (tsup + isolated-vm). Requires Node >= 22.
- `hoppscotch-js-sandbox` (`@hoppscotch/js-sandbox`) — JS execution sandbox (isolated-vm, faraday-cage).
- `hoppscotch-kernel` (`@hoppscotch/kernel`) — request execution engine (runtime interfaces + implementations; Tauri plugins optional peer dep).
- `hoppscotch-data` (`@hoppscotch/data`) — shared data models / schemas (collections, requests, environments; io-ts/verzod) consumed by web, CLI, kernel.
- `hoppscotch-desktop`, `hoppscotch-agent` — Tauri desktop apps (Rust + TS).
- `hoppscotch-relay` — Rust relay server.
- `hoppscotch-sh-admin` — self-host admin dashboard (Vue 3).
- `codemirror-lang-graphql` — CodeMirror language support for GraphQL.

## Commands (run from repo root)

- Install: `pnpm install` (postinstall hooks run GraphQL codegen + Prisma generate; needs a `.env` — see `.env.example`).
- Dev all: `pnpm dev` · Lint: `pnpm lint` · Lint fix: `pnpm lintfix` · Typecheck: `pnpm typecheck` · Test: `pnpm test` · Prod build: `pnpm generate`.
- Root scripts delegate to per-package `do-*` scripts (`do-lint`, `do-test`, `do-dev`, …) — that's why some packages only define `do-*` variants.
- Scoped (preferred for speed): `pnpm --filter <npm-package-name> run <script>`, e.g. `pnpm --filter @hoppscotch/common run test`, `pnpm --filter @hoppscotch/selfhost-web run lint:ts` (vue-tsc, slow), `pnpm --filter hoppscotch-backend run start:dev`.
- Run a single test file: common/cli use vitest — `pnpm --filter @hoppscotch/common exec vitest run src/helpers/<path>`; backend uses jest — `pnpm --filter hoppscotch-backend exec jest <pattern>` (jest `rootDir` is `src`, imports use `src/...` path aliases, coverage is collected by default).
- Regenerate backend GraphQL SDL: `pnpm gen-gql` (emits to root `gql-gen/backend-schema.gql`, consumed by frontend codegen).

Dev ports (see `docker-compose.yml`): app 3000, webapp bundle server 3200, backend 3170, admin dashboard 3100, postgres 5432.

## Architecture boundaries

- **Frontend never imports backend code.** Contract flow: backend schema (`src/gql-schema.ts`) → `pnpm gen-gql` emits SDL to `gql-gen/backend-schema.gql` → each frontend package runs graphql-codegen (`gql-codegen.yml`, at postinstall) against it, generating typed documents consumed via urql. The backend GraphQL schema is the source of truth; regenerate after schema changes.
- **`hoppscotch-common` contains the app; shells just host it.** Feature work (pages, components, stores, services) goes in `hoppscotch-common/src` (`components/`, `pages/`, `layouts/`, `composables/`, `helpers/`, `services/`, `newstore/`); `hoppscotch-selfhost-web` and `hoppscotch-desktop` are thin entry shells.
- **Request execution goes through `hoppscotch-kernel`** (which uses `hoppscotch-js-sandbox`). Do not reimplement request/response pipeline logic in UI code.
- **State management**: `newstore/` holds global persisted stores built on `DispatchingStore` (collections, environments, history, settings, and realtime sessions: WebSocket/SSE/Socket.IO/MQTT) with io-ts/verzod validation. Services use the `dioc` DI container (`services/`).
- Backend domain modules are self-contained per feature (`src/<domain>/` — `user-*`, `team-*`, `auth`, `admin`, `mock-server`, `published-docs`, …); follow that layout for new features.

## Conventions

- Vue 3 Composition API + TypeScript; `vue-tsc` typechecking is mandatory for web/common.
- `fp-ts` and `rxjs` are used heavily; reactive UI state uses `newstore`-style stores in `hoppscotch-common`.
- Data validation uses `io-ts`/`verzod` (e.g. in `newstore`, `services/persistence`).
- UI strings go through i18n (`packages/hoppscotch-common/locales/en.json` + others), not hardcoded.
- Styling: Tailwind. ESLint uses flat config; prod lint runs with `HOPP_LINT_FOR_PROD=true`.
- Commits: conventional commits (`commitlint`); husky pre-commit runs lint + typecheck.

## Gotchas

- `pnpm --filter` matches **npm package names**, not directory names — e.g. `@hoppscotch/common`, not `hoppscotch-common` (backend and sh-admin are unscoped).
- GraphQL codegen runs at `postinstall` — freshly generated types can diverge from committed state; run `pnpm install` (or the package's `gql-codegen` script) after changing queries/schema.
- Backend `start:dev` needs a real `DATABASE_URL` (postinstall only uses a placeholder for `prisma generate`).
- Never commit secrets; env vars and their meaning live in `.env.example`.
- `pnpm` overrides pin several transitive deps for security (vue, ws, etc.) — don't remove them without reason.
