import { describe, expect, test } from "vitest"
import { nextState, type UpdateState } from "../update-check"

// The shell reports phases on a channel whose delivery order it does not
// guarantee (the download and install events come from tasks spawned per
// chunk). These tests pin the reducer's half of the contract: a phase that has
// already been reported is never replaced by an earlier one.
describe("update state transitions", () => {
  test("advances download, install and restart in order", () => {
    let state: UpdateState = { kind: "idle" }

    state = nextState(state, { type: "DownloadStarted", totalBytes: 100 })
    expect(state.kind).toBe("downloading")

    state = nextState(state, {
      type: "DownloadProgress",
      progress: { downloaded: 50, total: 100 },
    })
    expect(state).toEqual({
      kind: "downloading",
      progress: { downloaded: 50, total: 100, percentage: 50 },
    })

    state = nextState(state, { type: "DownloadCompleted" })
    expect(state.kind).toBe("installing")

    state = nextState(state, { type: "RestartRequired" })
    expect(state.kind).toBe("ready_to_restart")
  })

  test("ignores a late install event once a restart is pending", () => {
    const ready: UpdateState = { kind: "ready_to_restart" }

    expect(nextState(ready, { type: "DownloadCompleted" }).kind).toBe(
      "ready_to_restart"
    )
    expect(nextState(ready, { type: "InstallStarted" }).kind).toBe(
      "ready_to_restart"
    )
  })

  test("ignores late download events once the install has started", () => {
    const installing: UpdateState = { kind: "installing" }

    expect(nextState(installing, { type: "DownloadStarted" }).kind).toBe(
      "installing"
    )
    expect(
      nextState(installing, {
        type: "DownloadProgress",
        progress: { downloaded: 10, total: 100 },
      }).kind
    ).toBe("installing")
  })

  test("keeps applying progress within the download phase", () => {
    const downloading: UpdateState = {
      kind: "downloading",
      progress: { downloaded: 10, total: 100, percentage: 10 },
    }

    expect(
      nextState(downloading, {
        type: "DownloadProgress",
        progress: { downloaded: 80, total: 100 },
      })
    ).toEqual({
      kind: "downloading",
      progress: { downloaded: 80, total: 100, percentage: 80 },
    })
  })
})
