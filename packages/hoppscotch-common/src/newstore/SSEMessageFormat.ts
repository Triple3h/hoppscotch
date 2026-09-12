import { distinctUntilChanged, pluck } from "rxjs"
import DispatchingStore, { defineDispatchers } from "./DispatchingStore"
import {
  CustomFormatPaths,
  MessageFormatPreset,
} from "~/helpers/sse/format"

/**
 * Global preference for the SSE timeline's "auto-merge" (delta
 * assembly) view: which message-format preset to extract streamed
 * text with, and the custom JSON paths when the preset is "custom".
 *
 * Kept global (not per-request) on purpose — the preset follows the
 * provider the user is currently debugging, and they switch it once
 * for every request. Persisted to localStorage so the choice survives
 * restarts.
 */

export type SSEMessageFormatState = {
  preset: MessageFormatPreset
  customPaths: CustomFormatPaths
  /** whether the auto-merge view includes the reasoning section */
  showReasoning: boolean
}

const STORAGE_KEY = "sse-message-format-preference"

const defaultState: SSEMessageFormatState = {
  preset: "openai",
  customPaths: {},
  showReasoning: true,
}

const loadPersisted = (): Partial<SSEMessageFormatState> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<SSEMessageFormatState>
    return {
      preset: parsed.preset,
      customPaths: parsed.customPaths,
      showReasoning: parsed.showReasoning,
    }
  } catch (_e) {
    return {}
  }
}

const persist = (state: SSEMessageFormatState) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (_e) {
    // Storage unavailable (private mode etc.) — preference stays in-memory
  }
}

const dispatchers = defineDispatchers({
  setPreset(curr: SSEMessageFormatState, { preset }: { preset: MessageFormatPreset }) {
    return { preset }
  },
  setCustomPaths(
    curr: SSEMessageFormatState,
    { paths }: { paths: CustomFormatPaths }
  ) {
    return { customPaths: paths }
  },
  setShowReasoning(
    curr: SSEMessageFormatState,
    { show }: { show: boolean }
  ) {
    return { showReasoning: show }
  },
})

const initial = { ...defaultState, ...loadPersisted() }

const SSEMessageFormatStore = new DispatchingStore(initial, dispatchers)

// Write-through: every committed state change lands in localStorage.
SSEMessageFormatStore.subject$.subscribe({
  next: (state) => persist(state),
})

export const SSEMessageFormat$ = SSEMessageFormatStore.subject$.asObservable()

export const sseMessageFormatPreset$ = SSEMessageFormatStore.subject$
  .pipe(pluck("preset"), distinctUntilChanged())

export function setSSEMessageFormatPreset(preset: MessageFormatPreset) {
  SSEMessageFormatStore.dispatch({
    dispatcher: "setPreset",
    payload: { preset },
  })
}

export function setSSECustomFormatPaths(paths: CustomFormatPaths) {
  SSEMessageFormatStore.dispatch({
    dispatcher: "setCustomPaths",
    payload: { paths },
  })
}

export function setSSEReasoningVisible(show: boolean) {
  SSEMessageFormatStore.dispatch({
    dispatcher: "setShowReasoning",
    payload: { show },
  })
}
