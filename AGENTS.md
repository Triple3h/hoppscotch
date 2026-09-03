# AGENTS.md

## What this is

A **privatized fork of Hoppscotch** (API client) that is **desktop-only and fully local**: all data is persisted on-device (no cloud accounts, no login, no backend, no team sync). The only deliverable is the **Tauri desktop app**. There is no server, database, web deployment, PWA, admin dashboard, or CLI.

It is a **pnpm monorepo**; packages live in `packages/*`. `pnpm install` is enforced via `only-allow pnpm` — never use npm/yarn.

## Packages

Note: npm-scoped packages — the `pnpm --filter` name differs from the directory name (e.g. dir `hoppscotch-common` is package `@hoppscotch/common`). `hoppscotch-desktop` is unscoped.

- `hoppscotch-common` (`@hoppscotch/common`) — **where almost all UI work happens**: components, pages, layouts, composables, `helpers/` (incl. `.graphql` documents and backend stubs), `services/`, `newstore/` state stores, i18n locales (`locales/`). Source of truth for the app; consumed by selfhost-web.
- `hoppscotch-selfhost-web` (`@hoppscotch/selfhost-web`) — the **web-app build target** (Vue 3 + Vite + Tailwind). `src/main.ts` assembles the app with a **single desktop platform config**. Its `dist/` is the frontend that gets bundled into the desktop app. Note: it is not meant to be hosted as a standalone website in this fork.
- `hoppscotch-desktop` (`hoppscotch-desktop`) — the **Tauri v2 launcher** (Rust + TS). Loads the web bundle (see build chain below) via `tauri-plugin-appload`, which injects `__KERNEL_MODE__="desktop"`. Rust code under `src-tauri/`, plus `crates/webapp-bundler` and `plugin-workspace/` (appload / relay plugins).
- `hoppscotch-kernel` (`@hoppscotch/kernel`) — request execution engine (runtime interfaces + implementations).
- `hoppscotch-js-sandbox` (`@hoppscotch/js-sandbox`) — JS execution sandbox (used for pre-request scripts / tests).
- `hoppscotch-data` (`@hoppscotch/data`) — shared data models / schemas (collections, requests, environments; io-ts/verzod).
- `codemirror-lang-graphql` (`@hoppscotch/codemirror-lang-graphql`) — CodeMirror language support for GraphQL.

Removed in this fork (do not expect them): backend, self-host admin, relay server, CLI, agent, docker/firebase/netlify deploy files.

## Build chain (desktop app)

`selfhost-web` build → bundle → Tauri build:

1. `pnpm --filter @hoppscotch/selfhost-web run build` (or `generate`) produces `packages/hoppscotch-selfhost-web/dist`.
2. `crates/webapp-bundler` (Rust) packs that `dist/` into `packages/hoppscotch-desktop/bundle.zip` + `manifest.json`.
3. `pnpm --filter hoppscotch-desktop tauri build` embeds `bundle.zip` into the Tauri app; on launch `tauri-plugin-appload` serves it in a webview with `__KERNEL_MODE__="desktop"`.

## Commands (run from repo root)

- Install: `pnpm install`. postinstall hooks run GraphQL codegen (needs `gql-gen/backend-schema.gql`, already committed) + package builds. `pnpm install --ignore-scripts` skips these (useful when only deps are needed). Requires a root `.env` only because the codegen plugin loads dotenv; an empty/missing `.env` is tolerated, `.env.example` documents the (mostly vestigial) variables.
- Lint: `pnpm lint` · Lint fix: `pnpm lintfix` · Typecheck: `pnpm typecheck` · Test: `pnpm test` · Prod build of web target: `pnpm --filter @hoppscotch/selfhost-web run build`.
- Root scripts delegate to per-package `do-*` scripts (`do-lint`, `do-test`, …).
- Scoped (preferred for speed): `pnpm --filter <npm-package-name> run <script>`, e.g. `pnpm --filter @hoppscotch/common run test`, `pnpm --filter @hoppscotch/common run prod-lint`, `pnpm --filter @hoppscotch/common exec vitest run src/helpers/<path>`, `pnpm --filter hoppscotch-desktop run lint:ts`.
- **Important**: in this environment, `@hoppscotch/common`'s direct `vue-tsc` CLI can crash (`vue-tsc` 1.8.8 + TS 5.9.3, "Search string not found"). Use `node type-check.mjs` (the `do-typecheck` script) or the newer `vue-tsc` inside `@hoppscotch/selfhost-web`.
- Regenerate frontend GraphQL types after editing `.graphql` docs: `pnpm --filter @hoppscotch/common run gql-codegen` (schema source: committed `gql-gen/backend-schema.gql`).

Dev servers (no docker): the backend/DB stack is gone. `packages/hoppscotch-selfhost-web` runs its own vite dev server for quick UI iteration; the full desktop app is developed/built via `hoppscotch-desktop` (Tauri), which needs Rust toolchain + platform webview deps (see `packages/hoppscotch-desktop/README.md`).

## Architecture boundaries

- **`hoppscotch-common` contains the app; shells just host it.** Feature work (pages, components, stores, services) goes in `hoppscotch-common/src`; `hoppscotch-selfhost-web` and `hoppscotch-desktop` are thin entry shells. Platform-specific code lives in `selfhost-web/src/platform/*` (auth/instance/infra) and in `common/src/platform/std/*`.
- **Request execution goes through `hoppscotch-kernel`** (which uses `hoppscotch-js-sandbox`). Do not reimplement request/response pipeline logic in UI code.
- **All data is local.** `newstore/` holds global persisted stores built on `DispatchingStore` (collections, environments, history, settings, realtime sessions, tabs, cookies) with io-ts/verzod validation; persistence is localStorage / Tauri store via `PersistenceService` (namespace `persistence.v1`). Services use the `dioc` DI container (`services/`).
- **No accounts/auth flows.** The auth platform implementations are local no-ops (`selfhost-web/src/platform/auth/desktop/index.ts`): no OAuth deep-link, no token refresh, no `/auth/logout`, no backend calls. Keep them that way when touching auth code.
- Backend GraphQL helpers under `common/src/helpers/backend/` are **dead stubs kept for type compatibility** (platform `backend` def is a no-op). Do not build new features on them.

## Conventions

- Vue 3 Composition API + TypeScript; `vue-tsc` typechecking is mandatory for web/common.
- `fp-ts` and `rxjs` are used heavily; reactive UI state uses `newstore`-style stores.
- Data validation uses `io-ts`/`verzod` (e.g. in `newstore`, `services/persistence`).
- UI strings go through i18n (`packages/hoppscotch-common/locales/en.json` + others), not hardcoded. All non-en locales must stay a subset of `en.json`.
- Styling: Tailwind. ESLint uses flat config; prod lint runs with `HOPP_LINT_FOR_PROD=true`.
- Commits: conventional commits (`commitlint`).

## Gotchas

- `pnpm --filter` matches **npm package names**, not directory names — e.g. `@hoppscotch/common`, not `hoppscotch-common` (desktop is unscoped).
- GraphQL codegen runs at `postinstall` against committed `gql-gen/backend-schema.gql`; re-run the package's `gql-codegen` script after changing `.graphql` docs.
- Do not re-add dependencies that were removed with the backend/web stack (firebase, urql backend exchanges are still used internally by helpers but have no reachable endpoints).
- `pnpm` overrides pin several transitive deps for security (vue, ws, etc.) — don't remove them without reason.
