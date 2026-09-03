import { pipe } from "fp-ts/function"
import * as TE from "fp-ts/TaskEither"
import { BehaviorSubject } from "rxjs"
import { pluck } from "rxjs/operators"
import { platform } from "~/platform"
import DispatchingStore, { defineDispatchers } from "./DispatchingStore"

import type { MockServer } from "~/helpers/backend/types/MockServer"

export type UpdateMockServerInput = {
  name?: string
  isActive?: boolean
  delayInMs?: number
  isPublic?: boolean
}

export type CreateMockServerModalData = {
  show: boolean
  collectionID?: string
  collectionName?: string
}

const defaultMockServerState = {
  mockServers: [] as MockServer[],
  loading: false,
}

type MockServerStoreType = typeof defaultMockServerState

const mockServerDispatchers = defineDispatchers({
  setMockServers(
    _: MockServerStoreType,
    { mockServers }: { mockServers: MockServer[] }
  ) {
    return {
      mockServers,
      loading: false,
    }
  },

  addMockServer(
    { mockServers }: MockServerStoreType,
    { mockServer }: { mockServer: MockServer }
  ) {
    return {
      mockServers: [...mockServers, mockServer],
    }
  },

  updateMockServer(
    { mockServers }: MockServerStoreType,
    { id, updates }: { id: string; updates: Partial<MockServer> }
  ) {
    return {
      mockServers: mockServers.map((server) =>
        server.id === id ? { ...server, ...updates } : server
      ),
    }
  },

  deleteMockServer(
    { mockServers }: MockServerStoreType,
    { id }: { id: string }
  ) {
    return {
      mockServers: mockServers.filter((server) => server.id !== id),
    }
  },

  setLoading(_: MockServerStoreType, { loading }: { loading: boolean }) {
    return {
      loading,
    }
  },
})

export const mockServerStore = new DispatchingStore(
  defaultMockServerState,
  mockServerDispatchers
)

export const mockServers$ = mockServerStore.subject$.pipe(pluck("mockServers"))
export const loading$ = mockServerStore.subject$.pipe(pluck("loading"))

export function setMockServers(mockServers: MockServer[]) {
  mockServerStore.dispatch({
    dispatcher: "setMockServers",
    payload: { mockServers },
  })
}

export function addMockServer(mockServer: MockServer) {
  mockServerStore.dispatch({
    dispatcher: "addMockServer",
    payload: { mockServer },
  })
}

export function updateMockServer(id: string, updates: Partial<MockServer>) {
  mockServerStore.dispatch({
    dispatcher: "updateMockServer",
    payload: { id, updates },
  })
}

export function deleteMockServer(id: string) {
  mockServerStore.dispatch({
    dispatcher: "deleteMockServer",
    payload: { id },
  })
}

export function setLoading(loading: boolean) {
  mockServerStore.dispatch({
    dispatcher: "setLoading",
    payload: { loading },
  })
}

// Modal state management
const defaultCreateMockServerModalState: CreateMockServerModalData = {
  show: false,
  collectionID: undefined,
  collectionName: undefined,
}

export const showCreateMockServerModal$ = new BehaviorSubject(
  defaultCreateMockServerModalState
)

// Load mock servers from backend (personal workspace)
export function loadMockServers(skip?: number, take?: number) {
  setLoading(true)
  return pipe(
    platform.backend.getMyMockServers(skip, take),
    TE.match(
      (error) => {
        console.error("Failed to load mock servers:", error)
        // Clear mock servers on error to prevent stale data
        setMockServers([])
      },
      (mockServers) => {
        setMockServers(mockServers)
      }
    )
  )()
}
