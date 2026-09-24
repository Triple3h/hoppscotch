import { ref, readonly, type Ref } from "vue"
import * as E from "fp-ts/Either"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// Bind to the unified, process-wide store rather than the org-scoped
// default `Store`. Persisted `UpdateState` is machine-level, not
// per-org, and the Tauri shell reads the same physical file through
// its own `kernel/store.ts` wrapper. Going through the org-scoped
// store would route writes to a file the shell never reads.
import { UnifiedStore as Store } from "~/kernel/store"
import {
  UPDATE_STATE_SCHEMA,
  UPDATE_STATE_STORE_KEY,
  UPDATE_STATE_STORE_NAMESPACE,
  type DownloadProgress as WireDownloadProgress,
  type UpdateState as PersistedUpdateState,
} from "~/platform/update-state"
import { Log } from "~/kernel/log"

const LOG_TAG = "useUpdateCheck"

/**
 * Webview-side accessor for the desktop updater.
 *
 * Wraps the Tauri updater commands (`check_for_updates`,
 * `download_and_install_update`, `restart_application`, `cancel_update`)
 * and the `updater-event` Tauri channel into a single reactive accessor.
 *
 * The flow a manual `check` starts has four steps, and the module owns the
 * state for all of them: the check reports what the release has (`available`),
 * the user's click fetches and prepares it (`download` for the installer,
 * `applyWebUpdate` for the web bundle), and `restart` applies it. Nothing here
 * restarts the app on its own.
 *
 * State is modelled as a discriminated union where each variant carries
 * exactly the fields that variant needs (the `available` variant carries
 * `latestVersion` and the "what's new" notes, the `downloading` variant
 * carries `progress`, and so on). Impossible combinations ("available
 * without a version", "not downloading but progress is set") are
 * unrepresentable by construction, and callers narrow through
 * `state.kind`.
 *
 * State transitions are owned by a single pure `applyEvent` function
 * driven by the `updater-event` channel. Action wrappers (`check`,
 * `download`, `restart`, `cancel`) await initialization before invoking
 * so the listener is guaranteed to be subscribed before any command
 * fires, and rely on the event stream for the transitions rather than
 * mutating state themselves. This removes the "fast path + event" drift
 * that made two paths responsible for updating the same refs.
 *
 * Module-level singleton: every caller gets the same reactive state so
 * any consumer (settings page, portable welcome, startup flow) sees the
 * same value.
 */

// Download progress with a derived `percentage`. The wire form from
// Rust and the persisted form only carry `downloaded` and optional
// `total`. The `percentage` is computed on top so the UI has a
// ready-to-bind field.
export interface DownloadProgress extends WireDownloadProgress {
  percentage: number
}

// Response from the `check_for_updates` Tauri command. Used only to
// invoke the command. Actual state transitions arrive on the event
// channel.
interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
}

// Response from `check_web_update` / `apply_web_update`. Mirrors
// `WebUpdateStatus` in `hoppscotch-desktop/src-tauri/src/web_update.rs`; only
// the fields this composable reads are declared.
interface WebUpdateStatus {
  state: "up-to-date" | "available" | "installed" | "needs-shell-update"
  currentVersion: string
  availableVersion?: string
}

// Tauri event payload variants. Must match the `UpdateEvent` tagged union in
// `hoppscotch-desktop/src/services/updater.client.ts`. Centralizing this
// type into common would remove the duplication, but the event channel is
// a Rust-to-webview wire contract that currently lives in the shell, so
// keeping the mirror here scoped to this composable is acceptable until
// that contract gets its own shared module.
type UpdateEvent =
  | { type: "CheckStarted" }
  | { type: "CheckCompleted"; info: UpdateInfo }
  | { type: "CheckFailed"; error: string }
  | { type: "DownloadStarted"; totalBytes?: number }
  // The Rust-emitted payload only carries `downloaded` and optional
  // `total`. The reducer derives `percentage` and the persisted
  // `DownloadProgress` form below extends with that derived field.
  | { type: "DownloadProgress"; progress: WireDownloadProgress }
  | { type: "DownloadCompleted" }
  | { type: "InstallStarted" }
  | { type: "InstallCompleted" }
  | { type: "RestartRequired" }
  | { type: "UpdateCancelled" }
  | { type: "Error"; message: string }

// The composable's internal state. Each variant carries exactly the
// fields that variant needs. `currentVersion` rides along with any
// post-check variant so the UI can display "currently on vX" context
// regardless of whether an update was found.
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | {
      kind: "available"
      currentVersion: string
      latestVersion: string
      // Which channel the version came from, and therefore which command the
      // button that follows has to run: the installer's download, or the web
      // bundle's fetch. Both end in the same restart.
      source: "installer" | "web"
      // In-app "what's new" body: grouped `### 分组` headings over `- 条目`
      // bullets, generated by `.github/scripts/build-update-notes.mjs` and
      // carried on the updater manifest. Optional because a release may ship
      // without notes and the persisted form may predate them. The web channel
      // never has any: its manifest does not carry them.
      releaseNotes?: string
    }
  | { kind: "not_available"; currentVersion: string }
  | { kind: "downloading"; progress: DownloadProgress }
  | { kind: "installing" }
  // The web-bundle channel: no installer, the new frontend is fetched,
  // verified and staged for the next launch. `staging_web_update` covers that
  // fetch, `web_update_ready` means nothing is left but a restart — the same
  // thing the installer path ends in, so both offer the same button.
  | { kind: "staging_web_update"; version: string }
  | { kind: "web_update_ready"; version: string }
  | { kind: "ready_to_restart" }
  | { kind: "error"; message: string }

// String-literal helper for consumers that want to compare without
// destructuring `state.kind` directly. `UpdateState["kind"]` gives the
// same union at the type level.
export const UpdateKind = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  NOT_AVAILABLE: "not_available",
  DOWNLOADING: "downloading",
  INSTALLING: "installing",
  READY_TO_RESTART: "ready_to_restart",
  ERROR: "error",
} as const satisfies Record<string, UpdateState["kind"]>

// Singleton state.
const state = ref<UpdateState>({ kind: "idle" })
let initPromise: Promise<void> | undefined
let unlistenFn: UnlistenFn | undefined

function percentageOf(downloaded: number, total: number | undefined): number {
  if (!total || total <= 0) return 0
  return (downloaded / total) * 100
}

/**
 * Derives the composable's internal `UpdateState` from the flat
 * persisted form. The persisted form is a wire contract with Rust and
 * older shell code, and translating on read keeps that contract
 * unchanged while the composable gets the richer internal type.
 */
function fromPersisted(
  persisted: PersistedUpdateState | null | undefined
): UpdateState {
  if (!persisted) return { kind: "idle" }

  switch (persisted.status) {
    case "idle":
      return { kind: "idle" }
    case "checking":
      return { kind: "checking" }
    case "available":
      // The persisted form is optional on `version`. If the writer
      // omitted it, fall back to idle rather than fabricating a version.
      return persisted.version
        ? {
            kind: "available",
            currentVersion: "",
            latestVersion: persisted.version,
            // The persisted form is written by the shell's updater, so an
            // update it describes is an installer one.
            source: "installer",
            // The persisted `message` is the same release-notes body (the
            // shell's updater wrote `updateResult.body` there), so the notes
            // survive a restart that happens before the user reads them.
            releaseNotes: persisted.message,
          }
        : { kind: "idle" }
    case "not_available":
      return { kind: "not_available", currentVersion: "" }
    case "downloading": {
      const downloaded = persisted.progress?.downloaded ?? 0
      const total = persisted.progress?.total
      return {
        kind: "downloading",
        progress: {
          downloaded,
          total,
          percentage: percentageOf(downloaded, total),
        },
      }
    }
    case "installing":
      return { kind: "installing" }
    case "ready_to_restart":
      return { kind: "ready_to_restart" }
    case "error":
      return { kind: "error", message: persisted.message ?? "Unknown error" }
  }
}

// The phases an update passes through while it is in flight, in order. The
// shell emits these on the `updater-event` channel from tasks it spawns per
// download chunk, so an event can arrive after a later phase was already
// reported. Ranking the phases lets a stale one be dropped rather than drag
// the UI backwards: the download-finished pair landing after `RestartRequired`
// is what left the settings page on "installing" forever with the new build
// already on disk.
const IN_FLIGHT_PHASES = [
  "downloading",
  "installing",
  "ready_to_restart",
] as const

type InFlightPhase = (typeof IN_FLIGHT_PHASES)[number]

// `-1` for every kind outside `IN_FLIGHT_PHASES` (idle, checking, error, ...),
// which an in-flight phase is always free to replace.
function phaseRank(kind: UpdateState["kind"]): number {
  return (IN_FLIGHT_PHASES as readonly string[]).indexOf(kind)
}

function isStale(current: UpdateState, next: InFlightPhase): boolean {
  return phaseRank(current.kind) > phaseRank(next)
}

/**
 * Pure reducer from current state + incoming event to next state. Kept
 * pure (no ref access, no side effects) so it can be exercised in
 * isolation and so the full transition table is readable at a glance.
 */
export function nextState(
  current: UpdateState,
  event: UpdateEvent
): UpdateState {
  switch (event.type) {
    case "CheckStarted":
      return { kind: "checking" }

    case "CheckCompleted":
      if (event.info.available && event.info.latestVersion) {
        return {
          kind: "available",
          currentVersion: event.info.currentVersion,
          latestVersion: event.info.latestVersion,
          // The only writer on this channel is the shell's updater.
          source: "installer",
          releaseNotes: event.info.releaseNotes,
        }
      }
      return {
        kind: "not_available",
        currentVersion: event.info.currentVersion,
      }

    case "CheckFailed":
      return { kind: "error", message: event.error }

    case "DownloadStarted":
      if (isStale(current, "downloading")) return current
      return {
        kind: "downloading",
        progress: {
          downloaded: 0,
          total: event.totalBytes,
          percentage: 0,
        },
      }

    case "DownloadProgress":
      if (isStale(current, "downloading")) return current
      // The wire form has no `percentage`. Without computing it
      // here, `Math.round(progress.percentage)` in the view runs on
      // `undefined` and the button label renders "Downloading NaN%"
      // for every progress tick. `DownloadStarted` above takes the
      // same approach.
      return {
        kind: "downloading",
        progress: {
          downloaded: event.progress.downloaded,
          total: event.progress.total,
          percentage: percentageOf(
            event.progress.downloaded,
            event.progress.total
          ),
        },
      }

    case "DownloadCompleted":
    case "InstallStarted":
      if (isStale(current, "installing")) return current
      return { kind: "installing" }

    case "InstallCompleted":
      // Install is a short step that transitions straight into awaiting a
      // restart. The `RestartRequired` event follows and flips the state,
      // so keep the current state here rather than double-transitioning.
      return current

    case "RestartRequired":
      return { kind: "ready_to_restart" }

    case "UpdateCancelled":
      return { kind: "idle" }

    case "Error":
      return { kind: "error", message: event.message }
  }
}

async function loadPersistedState(): Promise<void> {
  // Open the unified store before reading. The shell already opens
  // this path through `DesktopPersistenceService.init`, but the
  // webview runs in a separate window with its own process state, so
  // the underlying Tauri store still needs to be opened here. Repeat
  // calls land on the same on-disk file and are harmless.
  const initResult = await Store.init()
  if (E.isLeft(initResult)) {
    Log.warn(LOG_TAG, "Failed to init unified store", initResult.left)
  }

  const result = await Store.get<PersistedUpdateState | null>(
    UPDATE_STATE_STORE_NAMESPACE,
    UPDATE_STATE_STORE_KEY
  )
  if (E.isRight(result) && result.right) {
    const parsed = UPDATE_STATE_SCHEMA.safeParse(result.right)
    if (parsed.success) {
      state.value = fromPersisted(parsed.data)
    }
  }
}

async function subscribeToEvents(): Promise<void> {
  if (unlistenFn) return
  unlistenFn = await listen<UpdateEvent>("updater-event", (event) => {
    state.value = nextState(state.value, event.payload)
  })
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await loadPersistedState()
      await subscribeToEvents()
    })().catch((err) => {
      Log.error(LOG_TAG, "Initialization failed", err)
      initPromise = undefined
      throw err
    })
  }
  await initPromise
}

// Action wrappers. Each awaits initialization so the listener is guaranteed
// subscribed before the Tauri command runs. The installer commands report
// their transitions on the event channel, so those wrappers leave `state`
// alone on success and route failures back through the same reducer; the web
// bundle has no event channel and is set here directly. On `invoke` failure
// the installer wrappers feed a synthetic "failed" event through the reducer
// so the transition path stays uniform.
//
// A check only ever reports; nothing here fetches an update the user has not
// asked for with a click. The background half of the flow lives in the shell:
// it stages web bundles at startup, and the result of that is read back with
// `refreshStagedUpdate`.
async function check(): Promise<void> {
  await ensureInitialized()

  let installer: UpdateInfo
  try {
    installer = await invoke<UpdateInfo>("check_for_updates", {
      showNativeDialog: false,
    })
  } catch (err) {
    state.value = nextState(state.value, {
      type: "CheckFailed",
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }

  // The installer's answer is the one that counts when there is one: a shell
  // release ships a newer web bundle with it, so the web channel gets its turn
  // only when the shell has nothing to offer. Its own `available` state
  // arrived over the event channel above, and starting the update from there
  // is the user's click.
  if (!installer.available) await checkWebUpdate()
}

/**
 * Reports whether a web bundle update is published, as an `available` state.
 *
 * Filling in an `available` state is the whole job: the fetch belongs to the
 * click that follows, in [`applyWebUpdate`]. Anything else — no update, or a
 * release host that cannot be reached — falls back to a bundle that was staged
 * earlier, which is still one restart away.
 */
async function checkWebUpdate(): Promise<void> {
  let status: WebUpdateStatus
  try {
    status = await invoke<WebUpdateStatus>("check_web_update")
  } catch (err) {
    Log.warn(LOG_TAG, "Web bundle check failed", err)
    await refreshStagedUpdate()
    return
  }

  if (status.state !== "available") {
    await refreshStagedUpdate()
    return
  }

  state.value = {
    kind: "available",
    currentVersion: status.currentVersion,
    latestVersion: status.availableVersion ?? "",
    source: "web",
  }
}

/**
 * Fetches, verifies and stages the published web bundle.
 *
 * This is the web channel's answer to the installer's download: it ends the
 * same way, with the restart that puts the new bundle to work left to the
 * user, because swapping the live bundle would throw away whatever is in the
 * running webview.
 */
async function applyWebUpdate(): Promise<void> {
  const before = state.value
  state.value = {
    kind: "staging_web_update",
    version: before.kind === "available" ? before.latestVersion : "",
  }

  try {
    const applied = await invoke<WebUpdateStatus>("apply_web_update")
    if (applied.state !== "installed") {
      state.value = before
      return
    }

    state.value = {
      kind: "web_update_ready",
      version: applied.availableVersion ?? "",
    }
  } catch (err) {
    // A failed web update is an optimisation lost, not something to put in
    // front of the user: the app goes on running the bundle it has, and real
    // failures surface on the installer path, which is the one that replaces
    // the shell. Restoring the `available` state leaves the button in place
    // for another try.
    Log.warn(LOG_TAG, "Web bundle update failed", err)
    state.value = before
  }
}

/**
 * Picks up a web bundle that is already staged.
 *
 * The usual staging happens at startup, seconds before the app is usable, so
 * by the time anyone opens the section there is nothing left to watch — only
 * the restart. Called on mount for that reason, and again after a check has
 * had its say.
 */
async function refreshStagedUpdate(): Promise<void> {
  await ensureInitialized()

  let version: string | null = null
  try {
    version = await invoke<string | null>("pending_web_update")
  } catch (err) {
    Log.warn(LOG_TAG, "Failed to read the staged web bundle", err)
    return
  }

  if (!version) return
  // Never talk over a state that already has something to say: a download in
  // flight, an installer update waiting on a click, or an error.
  if (state.value.kind !== "idle" && state.value.kind !== "not_available")
    return

  state.value = { kind: "web_update_ready", version }
}

async function download(): Promise<void> {
  await ensureInitialized()
  try {
    await invoke("download_and_install_update")
  } catch (err) {
    state.value = nextState(state.value, {
      type: "Error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function restart(): Promise<void> {
  await ensureInitialized()
  try {
    await invoke("restart_application")
  } catch (err) {
    state.value = nextState(state.value, {
      type: "Error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function cancel(): Promise<void> {
  await ensureInitialized()
  try {
    await invoke("cancel_update")
    // State advances to `idle` via the `updater-event` channel. The
    // Rust updater emits `UpdateCancelled` on success, so the
    // subscribed listener applies the transition. Applying it here
    // as well would produce two `idle` transitions per cancel, which
    // is harmless today but would double-fire any future side effect
    // added to the `UpdateCancelled` case in `nextState`.
  } catch (err) {
    state.value = nextState(state.value, {
      type: "Error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export function useUpdateCheck(): {
  state: Readonly<Ref<UpdateState>>
  check: () => Promise<void>
  download: () => Promise<void>
  applyWebUpdate: () => Promise<void>
  refreshStagedUpdate: () => Promise<void>
  restart: () => Promise<void>
  cancel: () => Promise<void>
} {
  // Fire-and-forget initialization so the composable returns synchronously.
  // Actions await initialization internally before invoking commands, so
  // race-with-subscription is not possible through the action path. A
  // consumer that reads `state.value` immediately sees `idle`, which is
  // the correct default for a fresh mount.
  void ensureInitialized()

  return {
    state: readonly(state),
    check,
    download,
    applyWebUpdate,
    refreshStagedUpdate,
    restart,
    cancel,
  }
}
