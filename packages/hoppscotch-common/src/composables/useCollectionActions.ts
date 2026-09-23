import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import {
  generateUniqueRefId,
  getDefaultRESTRequest,
  HoppCollection,
  HoppGQLRequest,
  HoppGQLRequestResponse,
  HoppRESTRequest,
  HoppRESTRequestResponse,
  isGQLRequest,
  makeCollection,
  makeHoppGQLResponseOriginalRequest,
  makeHoppRESTResponseOriginalRequest,
} from "@hoppscotch/data"
import { getDefaultGQLRequest } from "~/helpers/graphql/default"
import { parse as parseGQLDocument } from "graphql"
import type { OperationDefinitionNode } from "graphql"
import { useService } from "dioc/vue"
import { stripJsonSerializedModulePrefix } from "@hoppscotch/js-sandbox/scripting"

import { pipe } from "fp-ts/function"
import * as A from "fp-ts/Array"
import * as O from "fp-ts/Option"
import { flow } from "fp-ts/function"

import yaml from "js-yaml"
import { cloneDeep, isEqual } from "lodash-es"
import { nextTick, ref } from "vue"
import { useReadonlyStream } from "~/composables/stream"
import { handleTokenValidation } from "~/helpers/handleTokenValidation"
import {
  getFoldersByPath,
  resolveSaveContextOnCollectionReorder,
  updateInheritedPropertiesForAffectedRequests,
  updateSaveContextForAffectedRequests,
} from "~/helpers/collection/collection"
import {
  getRequestsByPath,
  resolveSaveContextOnRequestReorder,
} from "~/helpers/collection/request"
import { stripRefIdReplacer } from "~/helpers/import-export/export"
import { hoppCollectionToOpenAPI } from "~/helpers/import-export/export/openapi"
import { HoppTabDocument } from "~/helpers/tab/document"
import type { Picked } from "~/helpers/types/HoppPicked"
import {
  addRESTCollection,
  addRESTFolder,
  cascadeParentCollectionForProperties,
  duplicateRESTCollection,
  editRESTCollection,
  editRESTFolder,
  editRESTRequest,
  moveRESTFolder,
  moveRESTRequest,
  navigateToFolderWithIndexPath,
  removeRESTCollection,
  removeRESTFolder,
  removeRESTRequest,
  restCollectionStore,
  restCollections$,
  saveRESTRequestAs,
  updateRESTCollectionOrder,
  updateRESTRequestOrder,
  sortRESTCollection,
  sortRESTFolder,
} from "~/newstore/collections"
import { platform } from "~/platform"
import { PersistedOAuthConfig } from "~/services/oauth/oauth.service"
import { PersistenceService } from "~/services/persistence"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { EditingProperties } from "~/components/collections/Properties.vue"
import { withStoredVariableValues } from "~/helpers/collection/collectionProperties"
import { CollectionRunnerData } from "~/components/http/test/RunnerModal.vue"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { CurrentSortValuesService } from "~/services/current-sort.service"
import {
  flushLocalStoresForCollectionTree,
  stripCollectionTreeForStore,
  stripClientLocalValuesForWire,
} from "~/helpers/clientLocalVariables"

export type ResponseConfigPayload = {
  folderPath: string | undefined
  requestIndex: string
  request: HoppRESTRequest | HoppGQLRequest
  responseName: string
  responseID: string
}

/**
 * Single command channel out of the collection tree (`MyCollections`).
 * Parent (`collections/index.vue`) dispatches these to the actions composable
 * or its own modal UI state — no more 20+ named emits.
 */
export type CollectionCommand =
  | { type: "display-modal-add" }
  | { type: "display-modal-import-export" }
  | {
      type: "add-request"
      payload: { path: string; folder: HoppCollection }
    }
  | {
      type: "add-gql-request"
      payload: { path: string; folder: HoppCollection }
    }
  | {
      type: "add-folder"
      payload: { path: string; folder: HoppCollection }
    }
  | {
      type: "run-collection"
      payload: { collectionIndex: string; collection: HoppCollection }
    }
  | {
      type: "edit-collection"
      payload: { collectionIndex: string; collection: HoppCollection }
    }
  | {
      type: "edit-folder"
      payload: { folderPath: string; folder: HoppCollection }
    }
  | {
      type: "duplicate-collection"
      payload: { pathOrID: string; collectionSyncID?: string }
    }
  | {
      type: "edit-request"
      payload: {
        folderPath: string
        requestIndex: string
        request: HoppRESTRequest | HoppGQLRequest
      }
    }
  | { type: "edit-response"; payload: ResponseConfigPayload }
  | {
      type: "duplicate-request"
      payload: { folderPath: string; request: HoppRESTRequest | HoppGQLRequest }
    }
  | { type: "duplicate-response"; payload: ResponseConfigPayload }
  | { type: "export-data"; payload: HoppCollection }
  | { type: "remove-collection"; payload: string }
  | { type: "remove-folder"; payload: string }
  | {
      type: "remove-request"
      payload: { folderPath: string | null; requestIndex: string }
    }
  | { type: "remove-response"; payload: ResponseConfigPayload }
  | {
      type: "select-request"
      payload: {
        request: HoppRESTRequest | HoppGQLRequest
        folderPath: string
        requestIndex: string
        isActive: boolean
      }
    }
  | { type: "select-response"; payload: ResponseConfigPayload }
  | {
      type: "sort-collections"
      payload: {
        collectionID: string | null
        sortOrder: "asc" | "desc"
        collectionRefID: string
      }
    }
  | {
      type: "add-example"
      payload: {
        folderPath: string
        request: HoppRESTRequest | HoppGQLRequest
        requestIndex: number
      }
    }
  | {
      type: "drop-request"
      payload: {
        folderPath: string
        requestIndex: string
        destinationCollectionIndex: string
        requestRefID?: string
      }
    }
  | {
      type: "drop-collection"
      payload: {
        collectionIndexDragged: string
        destinationCollectionIndex: string
      }
    }
  | {
      type: "update-request-order"
      payload: {
        dragedRequestIndex: string
        destinationRequestIndex: string | null
        destinationCollectionIndex: string
      }
    }
  | {
      type: "update-collection-order"
      payload: {
        dragedCollectionIndex: string
        destinationCollection: {
          destinationCollectionIndex: string | null
          destinationCollectionParentIndex: string | null
        }
      }
    }
  | { type: "select"; payload: Picked | null }

/**
 * Side effects / store commands for the REST collections panel.
 * Pure UI state (modal flags, rename inputs, filter) stays in the component.
 */
export function useCollectionActions() {
  const t = useI18n()
  const toast = useToast()
  const tabs = useService(WorkspaceTabsService)
  const persistenceService = useService(PersistenceService)
  const secretEnvironmentService = useService(SecretEnvironmentService)
  const currentEnvironmentValueService = useService(CurrentValueService)
  const currentSortValuesService = useService(CurrentSortValuesService)

  const myCollections = useReadonlyStream(restCollections$, [], "deep")

  // Shared loading flag for mutating modal flows (add / edit / confirm).
  const modalLoadingState = ref(false)
  const exportLoading = ref(false)

  // Export format-chooser modal state (owned here so async export work can
  // read the target collection after the modal closes).
  const showExportModal = ref(false)
  const exportTargetCollection = ref<HoppCollection | null>(null)
  let exportGeneration = 0

  // Runner modal state
  const showCollectionsRunnerModal = ref(false)
  const collectionRunnerData = ref<CollectionRunnerData | null>(null)

  const setRequestTabResponses = (
    tabRef: { value: { document: HoppTabDocument } },
    responses: HoppRESTRequest["responses"] | HoppGQLRequest["responses"]
  ) => {
    const doc = tabRef.value.document
    if (doc.type === "request") {
      doc.request.responses = responses as HoppRESTRequest["responses"]
    } else if (doc.type === "gql-request") {
      doc.request.responses = responses as HoppGQLRequest["responses"]
    }
  }

  const pathToLastIndex = (path: string) => {
    const pathArr = path.split("/")
    return parseInt(pathArr[pathArr.length - 1])
  }

  const pathToIndex = (path: string) => path.split("/")

  const isAlreadyInRoot = (id: string | null) => {
    if (!id) return true
    return pathToIndex(id).length === 1
  }

  const checkIfCollectionIsAParentOfTheChildren = (
    collectionIndexDragged: string,
    destinationCollectionIndex: string
  ) => {
    const collectionDraggedPath = pathToIndex(collectionIndexDragged)
    const destinationCollectionPath = pathToIndex(destinationCollectionIndex)

    if (collectionDraggedPath.length < destinationCollectionPath.length) {
      const slicedDestinationCollectionPath = destinationCollectionPath.slice(
        0,
        collectionDraggedPath.length
      )
      if (isEqual(slicedDestinationCollectionPath, collectionDraggedPath)) {
        return true
      }
      return false
    }

    return false
  }

  const isMoveToSameLocation = (
    draggedItemPath: string,
    destinationPath: string
  ) => {
    const draggedItemPathArr = pathToIndex(draggedItemPath)
    const destinationPathArr = pathToIndex(destinationPath)

    if (draggedItemPathArr.length > 0) {
      const draggedItemParentPathArr = draggedItemPathArr.slice(
        0,
        draggedItemPathArr.length - 1
      )

      if (isEqual(draggedItemParentPathArr, destinationPathArr)) {
        return true
      }
      return false
    }
  }

  const isSameSameParent = (
    draggedItemPath: string,
    destinationItemPath: string | null,
    destinationCollectionIndex: string | null
  ) => {
    const draggedItemIndex = pathToIndex(draggedItemPath)

    if (destinationItemPath === null && destinationCollectionIndex === null) {
      return draggedItemIndex.length === 1
    } else if (
      destinationItemPath === null &&
      destinationCollectionIndex !== null &&
      draggedItemIndex.length === 1
    ) {
      return draggedItemIndex[0] === destinationCollectionIndex
    } else if (
      destinationItemPath === null &&
      draggedItemIndex.length !== 1 &&
      destinationCollectionIndex !== null
    ) {
      const dragedItemParent = draggedItemIndex.slice(0, -1)
      return dragedItemParent.join("/") === destinationCollectionIndex
    }
    if (destinationItemPath === null) return false
    const destinationItemIndex = pathToIndex(destinationItemPath)

    if (draggedItemIndex.length === 1 && destinationItemIndex.length === 1) {
      return true
    } else if (draggedItemIndex.length === destinationItemIndex.length) {
      const dragedItemParent = draggedItemIndex.slice(0, -1)
      const destinationItemParent = destinationItemIndex.slice(0, -1)
      if (isEqual(dragedItemParent, destinationItemParent)) {
        return true
      }
      return false
    }
    return false
  }

  // ── Create / add ────────────────────────────────────────────────

  /** Returns true when the collection was created (modal may close). */
  const createRootCollection = async (name: string): Promise<boolean> => {
    modalLoadingState.value = true
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) {
      modalLoadingState.value = false
      return false
    }
    addRESTCollection(
      makeCollection({
        name,
        folders: [],
        requests: [],
        headers: [],
        auth: {
          authType: "none",
          authActive: true,
        },
        variables: [],
        description: "",
        preRequestScript: "",
        testScript: "",
      })
    )

    platform.analytics?.logEvent({
      type: "HOPP_CREATE_COLLECTION",
      platform: "rest",
      workspaceType: "personal",
      isRootCollection: true,
    })

    modalLoadingState.value = false
    return true
  }

  /** Returns true when the request was created (modal may close). */
  const createRequest = async (opts: {
    name: string
    isGql: boolean
    path: string | null
  }): Promise<boolean> => {
    const { name, isGql, path } = opts
    if (!path) return false

    const newRequest = isGql
      ? { ...getDefaultGQLRequest(), name }
      : { ...getDefaultRESTRequest(), name }

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return false

    const insertionIndex = saveRESTRequestAs(path, newRequest)

    if (isGql) {
      tabs.createNewTab({
        type: "gql-request",
        request: newRequest as HoppGQLRequest,
        isDirty: false,
        cursorPosition: 0,
        saveContext: {
          originLocation: "user-collection",
          folderPath: path,
          requestIndex: insertionIndex,
          requestRefID: (newRequest as HoppGQLRequest)._ref_id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(path, "rest"),
      })
    } else {
      tabs.createNewTab({
        type: "request",
        request: newRequest as HoppRESTRequest,
        isDirty: false,
        saveContext: {
          originLocation: "user-collection",
          folderPath: path,
          requestIndex: insertionIndex,
          requestRefID: (newRequest as HoppRESTRequest)._ref_id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(path, "rest"),
      })
    }

    platform.analytics?.logEvent({
      type: "HOPP_SAVE_REQUEST",
      workspaceType: "personal",
      createdNow: true,
      platform: isGql ? "gql" : "rest",
    })

    return true
  }

  /** Returns true when the folder was created (modal may close). */
  const createFolder = async (
    folderName: string,
    path: string | null
  ): Promise<boolean> => {
    if (!path) return false
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return false
    addRESTFolder(folderName, path)

    platform.analytics?.logEvent({
      type: "HOPP_CREATE_COLLECTION",
      workspaceType: "personal",
      isRootCollection: false,
      platform: "rest",
    })

    return true
  }

  // ── Tabs / selection ────────────────────────────────────────────

  /**
   * Opens (or focuses) the collection/folder in a tab — the tab owns the draft
   * and saves on Ctrl/Cmd+S, so nothing is written here.
   */
  const openCollectionTab = (payload: {
    path: string
    collection: HoppCollection
  }) => {
    const { path, collection } = payload

    const openTab = tabs
      .getTabs()
      .find(
        (tab) =>
          tab.document.type === "collection" && tab.document.folderPath === path
      )

    if (openTab) {
      tabs.setActiveTab(openTab.id)
      return
    }

    const parentPath = path.split("/").slice(0, -1).join("/")

    tabs.createNewTab({
      type: "collection",
      folderPath: path,
      collection: {
        ...cloneDeep(collection),
        // Display values live in the local secret/current-value stores, not in
        // the persisted collection — same read the properties modal does.
        variables: withStoredVariableValues(collection, path),
      },
      isDirty: false,
      inheritedProperties: parentPath
        ? cascadeParentCollectionForProperties(parentPath, "rest")
        : undefined,
    })
  }

  const editCollection = (payload: {
    collectionIndex: string
    collection: HoppCollection
  }) => {
    openCollectionTab({
      path: payload.collectionIndex,
      collection: payload.collection,
    })
  }

  const editFolder = (payload: {
    folderPath: string | undefined
    folder: HoppCollection
  }) => {
    if (!payload.folderPath) return

    openCollectionTab({
      path: payload.folderPath,
      collection: payload.folder,
    })
  }

  const selectRequest = (selectedRequest: {
    request: HoppRESTRequest | HoppGQLRequest
    folderPath: string
    requestIndex: string
    isActive: boolean
  }) => {
    const { request, folderPath, requestIndex } = selectedRequest
    let possibleTab = null

    const isGql = isGQLRequest(request)

    possibleTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex: parseInt(requestIndex),
      folderPath: folderPath!,
      requestRefID: request._ref_id ?? request.id,
    })

    if (possibleTab) {
      tabs.setActiveTab(possibleTab.value.id)
    } else if (isGql) {
      tabs.createNewTab({
        type: "gql-request",
        request: cloneDeep(request) as HoppGQLRequest,
        isDirty: false,
        cursorPosition: 0,
        saveContext: {
          originLocation: "user-collection",
          folderPath: folderPath!,
          requestIndex: parseInt(requestIndex),
          requestRefID: request._ref_id ?? request.id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          folderPath,
          "rest"
        ),
      })
    } else {
      tabs.createNewTab({
        type: "request",
        request: cloneDeep(request) as HoppRESTRequest,
        isDirty: false,
        saveContext: {
          originLocation: "user-collection",
          folderPath: folderPath!,
          requestIndex: parseInt(requestIndex),
          requestRefID: request._ref_id ?? request.id,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          folderPath,
          "rest"
        ),
      })
    }
  }

  const selectResponse = (payload: {
    folderPath: string
    requestIndex: string
    responseName: string
    request: HoppRESTRequest | HoppGQLRequest
    responseID: string
  }) => {
    const { folderPath, requestIndex, responseName, request, responseID } =
      payload

    // GQL examples have their own tab document type (`gql-example-response`)
    // backed by a GQL-shaped response payload; route there instead of the REST
    // `example-response` path which renders REST-only components.
    if (isGQLRequest(request)) {
      const gqlResponse = request.responses[responseName]
      if (!gqlResponse) return

      const possibleTab = tabs.getTabRefWithSaveContext({
        originLocation: "user-collection",
        requestIndex: parseInt(requestIndex),
        folderPath: folderPath!,
        exampleID: responseID,
      })

      if (possibleTab) {
        tabs.setActiveTab(possibleTab.value.id)
      } else {
        tabs.createNewTab({
          response: {
            ...cloneDeep(gqlResponse),
            name: responseName,
          },
          isDirty: false,
          type: "gql-example-response",
          saveContext: {
            originLocation: "user-collection",
            folderPath: folderPath!,
            requestIndex: parseInt(requestIndex),
            exampleID: responseID,
          },
          inheritedProperties: cascadeParentCollectionForProperties(
            folderPath,
            "rest"
          ),
        })
      }
      return
    }

    const response = request.responses[responseName]

    const possibleTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex: parseInt(requestIndex),
      folderPath: folderPath!,
      exampleID: responseID,
    })

    if (possibleTab) {
      tabs.setActiveTab(possibleTab.value.id)
    } else {
      tabs.createNewTab({
        response: {
          ...cloneDeep(response),
          name: responseName,
        },
        isDirty: false,
        type: "example-response",
        saveContext: {
          originLocation: "user-collection",
          folderPath: folderPath!,
          requestIndex: parseInt(requestIndex),
          exampleID: responseID,
        },
        inheritedProperties: cascadeParentCollectionForProperties(
          folderPath,
          "rest"
        ),
      })
    }
  }

  // ── Rename / update (modal payload driven) ──────────────────────

  /** Returns true when the rename was applied (modal may close). */
  const renameRequest = async (opts: {
    request: HoppRESTRequest | HoppGQLRequest | null
    newName: string
    folderPath: string | null
    requestIndex: number | null
  }): Promise<boolean> => {
    const { request, newName, folderPath, requestIndex } = opts
    if (!request) return false

    const requestUpdated = {
      ...request,
      name: newName || request.name,
    }
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return false

    if (folderPath === null || requestIndex === null) return false

    const possibleActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
    })

    editRESTRequest(folderPath, requestIndex, requestUpdated)

    if (
      possibleActiveTab &&
      (possibleActiveTab.value.document.type === "request" ||
        possibleActiveTab.value.document.type === "gql-request")
    ) {
      possibleActiveTab.value.document.request.name = requestUpdated.name
      nextTick(() => {
        possibleActiveTab.value.document.isDirty = false
      })
    }

    return true
  }

  /** Returns true when the response was renamed (modal may close). */
  const renameResponse = async (opts: {
    request: HoppRESTRequest | HoppGQLRequest | null
    oldName: string
    newName: string
    responseID: string | null
    folderPath: string | null
    requestIndex: number | null
  }): Promise<boolean> => {
    const {
      request: srcRequest,
      oldName: responseOldName,
      newName,
      responseID,
      folderPath,
      requestIndex,
    } = opts

    const request = cloneDeep(srcRequest)
    if (!request) return false
    if (!responseOldName) return false

    if (responseOldName !== newName) {
      // Convert object to entries array (preserving order)
      const entries = Object.entries(request.responses)

      // Replace the old key with the new key in the array
      const updatedEntries = entries.map(([key, value]) =>
        key === responseOldName
          ? [newName, { ...value, name: newName }]
          : [key, value]
      )

      // Convert the array back into an object
      request.responses = Object.fromEntries(updatedEntries)
    }

    if (folderPath === null || requestIndex === null) return false

    const possibleExampleActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
      exampleID: responseID ?? undefined,
    })

    const possibleRequestActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
    })

    editRESTRequest(folderPath, requestIndex, request)

    if (
      possibleExampleActiveTab &&
      (possibleExampleActiveTab.value.document.type === "example-response" ||
        possibleExampleActiveTab.value.document.type === "gql-example-response")
    ) {
      possibleExampleActiveTab.value.document.response.name = newName

      nextTick(() => {
        const docType = possibleExampleActiveTab.value.document.type
        if (
          docType !== "example-response" &&
          docType !== "gql-example-response"
        )
          return

        possibleExampleActiveTab.value.document.isDirty = false
        possibleExampleActiveTab.value.document.saveContext = {
          originLocation: "user-collection",
          folderPath: folderPath,
          requestIndex: requestIndex,
          exampleID: responseID!,
        }
      })
    }

    if (possibleRequestActiveTab) {
      setRequestTabResponses(possibleRequestActiveTab, request.responses)
    }

    toast.success(t("response.renamed"))
    return true
  }

  // ── Duplicate ───────────────────────────────────────────────────

  const duplicateCollection = async ({
    pathOrID,
    collectionSyncID,
  }: {
    pathOrID: string
    collectionSyncID?: string
  }) => {
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    duplicateRESTCollection(pathOrID, collectionSyncID)
  }

  const duplicateRequest = async (payload: {
    folderPath: string
    request: HoppRESTRequest | HoppGQLRequest
  }) => {
    const { folderPath, request } = payload
    if (!folderPath) return

    const { id: _, ...requestWithoutID } = request
    const cloned = cloneDeep(requestWithoutID)
    const newRequest = {
      ...cloned,
      _ref_id: generateUniqueRefId("req"),
      name: `${request.name} - ${t("action.duplicate")}`,
    } as HoppRESTRequest | HoppGQLRequest

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    saveRESTRequestAs(folderPath, newRequest)
    toast.success(t("request.duplicated"))
  }

  const duplicateResponse = async (payload: ResponseConfigPayload) => {
    const { folderPath, requestIndex, request, responseName } = payload

    const response = request.responses[responseName]

    if (!response || !folderPath || !requestIndex) return

    const newName = `${responseName} - ${t("action.duplicate")}`

    // if the new name is already taken, show a toast and return
    if (Object.keys(request.responses).includes(newName)) {
      toast.error(t("response.duplicate_name_error"))
      return
    }

    const newResponse = {
      ...cloneDeep(response),
      name: newName,
    }

    const updatedRequest = {
      ...request,
      responses: {
        ...request.responses,
        [newResponse.name]: newResponse,
      },
    }

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    editRESTRequest(folderPath, parseInt(requestIndex), updatedRequest)
    toast.success(t("response.duplicated"))

    const possibleRequestActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex: parseInt(requestIndex),
      folderPath,
    })

    if (possibleRequestActiveTab) {
      setRequestTabResponses(possibleRequestActiveTab, updatedRequest.responses)
    }
  }

  // ── Example responses ───────────────────────────────────────────

  /**
   * GQL counterpart of the REST add-example flow. Builds a
   * `HoppGQLRequestResponse` with an empty body, persists it under the parent
   * request's `responses` map, and opens it as a new `gql-example-response` tab.
   * Persistence goes through the REST mutation because unified-workspace GQL
   * bodies live in REST collection rows.
   */
  const addGQLExample = async (
    request: HoppGQLRequest,
    exampleName: string,
    folderPath: string | null,
    requestIndex: number | null,
    onCloseModal: () => void
  ) => {
    if (request.responses && request.responses[exampleName]) {
      toast.error(t("response.duplicate_name_error"))
      return false
    }

    const originalRequest = makeHoppGQLResponseOriginalRequest({
      name: request.name,
      url: request.url,
      query: request.query,
      variables: request.variables,
      headers: request.headers,
      auth: request.auth,
    })

    // Stamp the operation identity from the request's document (first
    // operation — the one a run would execute) so the mock server can match
    // this example; without stamps the matcher skips it entirely
    let operationName: string | undefined
    let operationType: string | undefined
    try {
      const operation = parseGQLDocument(request.query).definitions.find(
        (definition): definition is OperationDefinitionNode =>
          definition.kind === "OperationDefinition"
      )
      if (operation) {
        operationType = operation.operation
        operationName = operation.name?.value
      }
    } catch (_e) {
      // Unparseable document — leave the example unstamped
    }

    const newExample: HoppGQLRequestResponse = {
      name: exampleName,
      code: 200,
      status: "OK",
      headers: [],
      body: "",
      originalRequest,
      ...(operationType ? { operationType } : {}),
      ...(operationName ? { operationName } : {}),
    }

    const newExampleID = Object.keys(request.responses ?? {}).length.toString()

    const updatedRequest: HoppGQLRequest = {
      ...request,
      responses: {
        ...(request.responses ?? {}),
        [exampleName]: newExample,
      },
    }

    if (folderPath === null || requestIndex === null) return false

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return false

    editRESTRequest(folderPath, requestIndex, updatedRequest)
    toast.success(t("response.saved"))

    const possibleRequestActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
    })
    if (
      possibleRequestActiveTab &&
      possibleRequestActiveTab.value.document.type === "gql-request"
    ) {
      possibleRequestActiveTab.value.document.request.responses =
        updatedRequest.responses
    }

    onCloseModal()

    tabs.createNewTab({
      response: { ...cloneDeep(newExample), name: exampleName },
      isDirty: false,
      type: "gql-example-response",
      saveContext: {
        originLocation: "user-collection",
        folderPath,
        requestIndex,
        exampleID: newExampleID,
      },
      inheritedProperties: cascadeParentCollectionForProperties(
        folderPath,
        "rest"
      ),
    })
    return true
  }

  /**
   * Returns true when the example was created (modal may close + open tab).
   * `onCloseModal` runs before the new example tab is opened (matches the
   * original order: close modal first, then open the example tab).
   */
  const addExample = async (opts: {
    request: HoppRESTRequest | HoppGQLRequest | null
    exampleName: string
    folderPath: string | null
    requestIndex: number | null
    onCloseModal: () => void
  }): Promise<boolean> => {
    const { request, exampleName, folderPath, requestIndex, onCloseModal } =
      opts

    if (!exampleName) {
      toast.error(t("response.invalid_name"))
      return false
    }

    if (!request || !request.name) {
      toast.error(t("error.invalid_request"))
      return false
    }

    // GQL examples have a parallel-but-distinct shape
    if (isGQLRequest(request)) {
      return addGQLExample(
        request,
        exampleName,
        folderPath,
        requestIndex,
        onCloseModal
      )
    }

    // Check if example name already exists
    if (request.responses && request.responses[exampleName]) {
      toast.error(t("response.duplicate_name_error"))
      return false
    }

    // Create the original request from the parent request
    const originalRequest = makeHoppRESTResponseOriginalRequest({
      name: request.name,
      method: request.method,
      endpoint: request.endpoint,
      headers: request.headers,
      params: request.params,
      body: request.body,
      auth: request.auth,
      requestVariables: request.requestVariables,
    })

    // Create a new example response with default values and original request
    const newExample: HoppRESTRequestResponse = {
      name: exampleName,
      code: 200,
      status: "OK",
      headers: [],
      body: "",
      originalRequest,
    }

    // Calculate the new example's index (will be used as exampleID)
    const existingResponsesCount = request.responses
      ? Object.keys(request.responses).length
      : 0
    const newExampleID = existingResponsesCount.toString()

    const updatedRequest = {
      ...request,
      responses: {
        ...request.responses,
        [exampleName]: newExample,
      },
    }

    if (folderPath === null || requestIndex === null) return false

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return false

    editRESTRequest(folderPath, requestIndex, updatedRequest)
    toast.success(t("response.saved"))

    const possibleRequestActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
    })

    // Update request tab responses if it's open
    if (
      possibleRequestActiveTab &&
      possibleRequestActiveTab.value.document.type === "request"
    ) {
      possibleRequestActiveTab.value.document.request.responses =
        updatedRequest.responses
    }

    // Close the modal first
    onCloseModal()

    // Open the new example in a new tab
    tabs.createNewTab({
      response: {
        ...cloneDeep(newExample),
        name: exampleName,
      },
      isDirty: false,
      type: "example-response",
      saveContext: {
        originLocation: "user-collection",
        folderPath: folderPath,
        requestIndex: requestIndex,
        exampleID: newExampleID,
      },
      inheritedProperties: cascadeParentCollectionForProperties(
        folderPath,
        "rest"
      ),
    })
    return true
  }

  type RemoveResult = "done" | "abort"

  const removeRootCollection = async (
    collectionIndex: number | null,
    isSelected: () => boolean,
    onDeselect: () => void
  ): Promise<RemoveResult> => {
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return "abort"

    const collectionToRemove =
      collectionIndex || collectionIndex === 0
        ? navigateToFolderWithIndexPath(restCollectionStore.value.state, [
            collectionIndex,
          ])
        : undefined

    if (collectionIndex === null) return "abort"

    if (isSelected()) {
      onDeselect()
    }

    removeRESTCollection(
      collectionIndex,
      collectionToRemove ? collectionToRemove.id : undefined
    )

    resolveSaveContextOnCollectionReorder({
      lastIndex: collectionIndex,
      newIndex: -1,
      folderPath: "", // root folder
      length: myCollections.value.length,
    })

    toast.success(t("state.deleted"))

    if (collectionToRemove) {
      flushLocalStoresForCollectionTree(collectionToRemove)
    }
    return "done"
  }

  const removeFolder = async (
    folderPath: string | null,
    isSelected: () => boolean,
    onDeselect: () => void
  ): Promise<RemoveResult> => {
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return "abort"

    if (!folderPath) return "abort"

    if (isSelected()) {
      onDeselect()
    }

    const folderToRemove = navigateToFolderWithIndexPath(
      restCollectionStore.value.state,
      folderPath.split("/").map((i) => parseInt(i))
    )

    removeRESTFolder(folderPath, folderToRemove ? folderToRemove.id : undefined)

    const parentFolder = folderPath.split("/").slice(0, -1).join("/")
    resolveSaveContextOnCollectionReorder({
      lastIndex: pathToLastIndex(folderPath),
      newIndex: -1,
      folderPath: parentFolder,
      length: getFoldersByPath(myCollections.value, parentFolder).length,
    })

    toast.success(t("state.deleted"))

    if (folderToRemove) {
      flushLocalStoresForCollectionTree(folderToRemove)
    }
    return "done"
  }

  const removeRequest = async (
    folderPath: string | null,
    requestIndex: number | null,
    isSelected: () => boolean,
    onDeselect: () => void
  ): Promise<RemoveResult> => {
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return "abort"

    if (folderPath === null || requestIndex === null) return "abort"

    if (isSelected()) {
      onDeselect()
    }

    const possibleTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      folderPath,
      requestIndex,
    })

    if (possibleTab) {
      const doc = possibleTab.value.document
      if (doc.type === "request") {
        doc.saveContext = null
        doc.isDirty = true
        doc.request.responses = {}
        doc.inheritedProperties = undefined
      } else if (doc.type === "gql-request") {
        doc.saveContext = null
        doc.isDirty = true
        doc.request.responses = {}
        doc.inheritedProperties = undefined
      }
    }

    const requestToRemove = navigateToFolderWithIndexPath(
      restCollectionStore.value.state,
      folderPath.split("/").map((i) => parseInt(i))
    )?.requests[requestIndex]

    removeRESTRequest(folderPath, requestIndex, requestToRemove?.id)

    // the same function is used to reorder requests since after removing, it's basically doing reorder
    resolveSaveContextOnRequestReorder({
      lastIndex: requestIndex,
      newIndex: -1,
      folderPath,
      length: getRequestsByPath(myCollections.value, folderPath).length,
    })

    toast.success(t("state.deleted"))
    return "done"
  }

  const removeResponse = async (opts: {
    request: HoppRESTRequest | HoppGQLRequest | null
    responseName: string
    responseID: string | null
    folderPath: string | null
    requestIndex: number | null
  }): Promise<RemoveResult> => {
    const {
      request: srcRequest,
      responseName,
      responseID,
      folderPath,
      requestIndex,
    } = opts

    const request = cloneDeep(srcRequest)
    if (!request) return "abort"

    delete request.responses[responseName]

    const requestUpdated: HoppRESTRequest | HoppGQLRequest = {
      ...request,
    }

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return "abort"

    if (folderPath === null || requestIndex === null) return "abort"

    editRESTRequest(folderPath, requestIndex, requestUpdated)

    const possibleActiveResponseTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      folderPath,
      requestIndex,
      exampleID: responseID ?? undefined,
    })

    const possibleRequestActiveTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      requestIndex,
      folderPath,
    })

    // If there is a tab attached to this response (REST or GQL example), close
    // it and set the active tab to the first one.
    if (
      possibleActiveResponseTab &&
      (possibleActiveResponseTab.value.document.type === "example-response" ||
        possibleActiveResponseTab.value.document.type ===
          "gql-example-response")
    ) {
      const activeTabs = tabs.getActiveTabs()

      // if the last tab is the one we are closing, we need to create a new tab
      if (
        activeTabs.value.length === 1 &&
        activeTabs.value[0].id === possibleActiveResponseTab.value.id
      ) {
        tabs.createNewTab({
          request: getDefaultRESTRequest(),
          isDirty: false,
          type: "request",
          saveContext: undefined,
        })
        tabs.closeTab(possibleActiveResponseTab.value.id)
      } else {
        tabs.closeTab(possibleActiveResponseTab.value.id)
        tabs.setActiveTab(activeTabs.value[0].id)
      }
    }

    if (possibleRequestActiveTab) {
      setRequestTabResponses(possibleRequestActiveTab, requestUpdated.responses)
    }

    toast.success(t("state.deleted"))
    return "done"
  }

  // ── Drag & drop / reorder ───────────────────────────────────────

  const dropRequest = async (payload: {
    folderPath?: string | undefined
    requestIndex: string
    destinationCollectionIndex: string
    destinationParentPath?: string
    requestRefID?: string
    onDragEnd?: () => void
  }) => {
    const {
      folderPath,
      requestIndex,
      destinationCollectionIndex,
      requestRefID,
    } = payload

    if (!requestIndex || !destinationCollectionIndex || !folderPath) return

    let possibleTab = null

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    possibleTab = tabs.getTabRefWithSaveContext({
      originLocation: "user-collection",
      folderPath,
      requestIndex: pathToLastIndex(requestIndex),
      requestRefID,
    })

    if (
      possibleTab &&
      (possibleTab.value.document.type === "request" ||
        possibleTab.value.document.type === "gql-request")
    ) {
      possibleTab.value.document.saveContext = {
        originLocation: "user-collection",
        folderPath: destinationCollectionIndex,
        requestIndex: getRequestsByPath(
          myCollections.value,
          destinationCollectionIndex
        ).length,
        requestRefID: possibleTab.value.document.request._ref_id,
      }

      possibleTab.value.document.inheritedProperties =
        cascadeParentCollectionForProperties(destinationCollectionIndex, "rest")
    }

    // When it's drop it's basically getting deleted from last folder. reordering last folder accordingly
    resolveSaveContextOnRequestReorder({
      lastIndex: pathToLastIndex(requestIndex),
      newIndex: -1, // being deleted from last folder
      folderPath,
      length: getRequestsByPath(myCollections.value, folderPath).length,
    })
    moveRESTRequest(
      folderPath,
      pathToLastIndex(requestIndex),
      destinationCollectionIndex
    )

    toast.success(`${t("request.moved")}`)
    payload.onDragEnd?.()
  }

  const dropCollection = async (payload: {
    collectionIndexDragged: string
    destinationCollectionIndex: string
    onDragEnd?: () => void
  }) => {
    const { collectionIndexDragged, destinationCollectionIndex } = payload
    if (!collectionIndexDragged || !destinationCollectionIndex) return
    if (collectionIndexDragged === destinationCollectionIndex) return

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    if (
      checkIfCollectionIsAParentOfTheChildren(
        collectionIndexDragged,
        destinationCollectionIndex
      )
    ) {
      toast.error(`${t("collection.parent_coll_move")}`)
      return
    }

    //check if the collection is being moved to its own parent
    if (
      isMoveToSameLocation(collectionIndexDragged, destinationCollectionIndex)
    ) {
      return
    }

    const parentFolder = collectionIndexDragged
      .split("/")
      .slice(0, -1)
      .join("/")
    const totalFoldersOfDestinationCollection =
      getFoldersByPath(myCollections.value, destinationCollectionIndex).length -
      (parentFolder === destinationCollectionIndex ? 1 : 0)

    moveRESTFolder(collectionIndexDragged, destinationCollectionIndex)

    resolveSaveContextOnCollectionReorder(
      {
        lastIndex: pathToLastIndex(collectionIndexDragged),
        newIndex: -1,
        folderPath: parentFolder,
        length: getFoldersByPath(myCollections.value, parentFolder).length,
      },
      "drop"
    )

    const newCollectionPath = `${destinationCollectionIndex}/${totalFoldersOfDestinationCollection}`

    updateSaveContextForAffectedRequests(
      collectionIndexDragged,
      newCollectionPath
    )

    updateInheritedPropertiesForAffectedRequests(newCollectionPath, "rest")

    payload.onDragEnd?.()
    toast.success(`${t("collection.moved")}`)
  }

  const dropToRoot = async (
    { dataTransfer }: DragEvent,
    onDragEnd?: () => void
  ) => {
    if (dataTransfer) {
      const collectionIndexDragged = dataTransfer.getData("collectionIndex")
      if (!collectionIndexDragged) return
      const isValidToken = await handleTokenValidation()
      if (!isValidToken) return
      // check if the collection is already in the root
      if (isAlreadyInRoot(collectionIndexDragged)) {
        toast.error(`${t("collection.invalid_root_move")}`)
      } else {
        moveRESTFolder(collectionIndexDragged, null)
        toast.success(`${t("collection.moved")}`)

        const rootLength = myCollections.value.length

        updateSaveContextForAffectedRequests(
          collectionIndexDragged,
          `${rootLength - 1}`
        )

        updateInheritedPropertiesForAffectedRequests(
          `${rootLength - 1}`,
          "rest"
        )
      }

      onDragEnd?.()
    }
  }

  const updateRequestOrder = async (payload: {
    dragedRequestIndex: string
    destinationRequestIndex: string | null
    destinationCollectionIndex: string
  }) => {
    const {
      dragedRequestIndex,
      destinationRequestIndex,
      destinationCollectionIndex,
    } = payload

    if (!dragedRequestIndex || !destinationCollectionIndex) return

    if (dragedRequestIndex === destinationRequestIndex) return

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    if (
      !isSameSameParent(
        dragedRequestIndex,
        destinationRequestIndex,
        destinationCollectionIndex
      )
    ) {
      toast.error(`${t("collection.different_parent")}`)
    } else {
      updateRESTRequestOrder(
        pathToLastIndex(dragedRequestIndex),
        destinationRequestIndex
          ? pathToLastIndex(destinationRequestIndex)
          : null,
        destinationCollectionIndex
      )

      toast.success(`${t("request.order_changed")}`)
    }
  }

  const updateCollectionOrder = async (payload: {
    dragedCollectionIndex: string
    destinationCollection: {
      destinationCollectionIndex: string | null
      destinationCollectionParentIndex: string | null
    }
  }) => {
    const { dragedCollectionIndex, destinationCollection } = payload
    const { destinationCollectionIndex, destinationCollectionParentIndex } =
      destinationCollection
    if (!dragedCollectionIndex) return
    if (dragedCollectionIndex === destinationCollectionIndex) return

    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
    if (
      !isSameSameParent(
        dragedCollectionIndex,
        destinationCollectionIndex,
        destinationCollectionParentIndex
      )
    ) {
      toast.error(`${t("collection.different_parent")}`)
    } else {
      updateRESTCollectionOrder(
        dragedCollectionIndex,
        destinationCollectionIndex
      )
      resolveSaveContextOnCollectionReorder({
        lastIndex: pathToLastIndex(dragedCollectionIndex),
        newIndex: pathToLastIndex(
          destinationCollectionIndex ? destinationCollectionIndex : ""
        ),
        folderPath: dragedCollectionIndex.split("/").slice(0, -1).join("/"),
      })
      toast.success(`${t("collection.order_changed")}`)
    }
  }

  const sortCollections = (payload: {
    collectionID: string | null
    sortOrder: "asc" | "desc"
    collectionRefID: string
  }) => {
    const { collectionID, sortOrder, collectionRefID } = payload

    const collectionIndex = collectionID ? parseInt(collectionID) : null

    if (isAlreadyInRoot(collectionID)) {
      sortRESTCollection(collectionIndex, sortOrder)
      toast.success(t("collection.sorted"))
    } else {
      if (!collectionID) return

      sortRESTFolder(collectionID, sortOrder)
      toast.success(t("folder.sorted"))
    }

    // Set the sort option in the service to persist the sort option
    // when the user navigates away and comes back
    currentSortValuesService.setSortOption(collectionRefID, {
      sortBy: "name",
      sortOrder,
    })
  }

  // ── Import / export ─────────────────────────────────────────────

  /**
   * Create a downloadable file from a collection and prompts the user to download it.
   */
  const initializeDownloadCollection = async (
    collectionJSON: string,
    name: string | null
  ) => {
    const result = await platform.kernelIO.saveFileWithDialog({
      data: collectionJSON,
      contentType: "application/json",
      suggestedFilename: `${name ?? "collection"}.json`,
      filters: [
        {
          name: "Hoppscotch Collection JSON file",
          extensions: ["json"],
        },
      ],
    })

    if (result.type === "unknown" || result.type === "saved") {
      toast.success(t("state.download_started").toString())
      platform.analytics?.logEvent({
        type: "HOPP_EXPORT_COLLECTION",
        exporter: "json",
        platform: "rest",
      })
    }
  }

  /**
   * Entry point from the collection context menu. Opens the format-chooser
   * modal so the user can pick between Hoppscotch JSON and OpenAPI 3.1.
   */
  const exportData = (collection: HoppCollection) => {
    exportTargetCollection.value = collection
    showExportModal.value = true
  }

  const closeExportModal = () => {
    // Bump so any in-flight export's `finally` no-ops instead of closing a
    // freshly-opened modal after this dismissal.
    exportGeneration++
    showExportModal.value = false
    exportTargetCollection.value = null
    exportLoading.value = false
  }

  /**
   * Native Hoppscotch JSON export (the original behavior of `exportData`).
   */
  const doExportHoppCollection = async (collection: HoppCollection) => {
    // Strip `export {};\n` from `testScript` and `preRequestScript` fields, and
    // strip `_ref_id` / secret variable values via `stripCollectionTreeForStore`
    // so neither leaks into the exported file.
    const stringifyForExport = (coll: HoppCollection): string =>
      stripJsonSerializedModulePrefix(
        JSON.stringify(stripCollectionTreeForStore(coll), stripRefIdReplacer, 2)
      )

    exportLoading.value = true
    try {
      await initializeDownloadCollection(
        stringifyForExport(collection),
        collection.name
      )
    } catch {
      toast.error(t("error.something_went_wrong"))
    }
  }

  const onExportHopp = async () => {
    const collection = exportTargetCollection.value
    if (!collection) return
    // `doExportHoppCollection` sets `exportLoading = true` on entry; the reset
    // is owned here via the generation-guarded `closeExportModal()` so a stale
    // in-flight export cannot re-enable buttons on a freshly-opened modal.
    // Same `exportGeneration` pattern as `doExportOpenAPI`.
    const thisGeneration = ++exportGeneration
    try {
      await doExportHoppCollection(collection)
    } finally {
      if (thisGeneration === exportGeneration) closeExportModal()
    }
  }

  const doExportOpenAPI = async (format: "json" | "yaml") => {
    const collection = exportTargetCollection.value
    if (!collection) return

    const thisGeneration = ++exportGeneration

    const saveOpenAPIDoc = async (
      openAPIDoc: Record<string, unknown>,
      name: string
    ) => {
      const isYaml = format === "yaml"
      let data: string
      try {
        data = isYaml
          ? yaml.dump(openAPIDoc)
          : JSON.stringify(openAPIDoc, null, 2)
      } catch {
        toast.error(t("error.something_went_wrong"))
        return
      }
      const contentType = isYaml ? "application/x-yaml" : "application/json"
      const extension = isYaml ? "yaml" : "json"

      // `saveFileWithDialog` returns a discriminated SaveFileResponse and does
      // not throw — checking `result.type` is the only correct way to know if
      // the user actually saved or cancelled.
      const result = await platform.kernelIO.saveFileWithDialog({
        data,
        contentType,
        suggestedFilename: `${name}-openapi.${extension}`,
        filters: [
          {
            name: `OpenAPI ${extension.toUpperCase()} file`,
            extensions: [extension],
          },
        ],
      })

      if (result.type === "saved" || result.type === "unknown") {
        toast.success(t("state.download_started").toString())
        platform.analytics?.logEvent({
          type: "HOPP_EXPORT_COLLECTION",
          exporter: "openapi",
          platform: "rest",
        })
      }
    }

    exportLoading.value = true

    try {
      // Chooser modal warns about lossiness upfront; per-export warnings would
      // be redundant.
      const { doc: openAPIDoc } = hoppCollectionToOpenAPI(collection)
      const name = collection.name
      await saveOpenAPIDoc(openAPIDoc, name)
    } catch {
      toast.error(t("error.something_went_wrong"))
    } finally {
      if (thisGeneration === exportGeneration) closeExportModal()
    }
  }

  const onExportOpenAPI = (format: "json" | "yaml") => {
    // Modal stays open through the export to keep the loading state visible;
    // doExportOpenAPI closes it when finished.
    doExportOpenAPI(format)
  }

  // ── Collection properties ───────────────────────────────────────

  /** Returns true when properties were applied (modal may close). */
  const setCollectionProperties = (newCollection: {
    collection: Partial<HoppCollection> | null
    isRootCollection: boolean
    path: string
  }): boolean => {
    const { collection, path, isRootCollection } = newCollection

    if (!collection) return false

    // We default to using collection.id but during the callback to our application, collection.id is not being preserved.
    // Since path is being preserved, we extract the collectionId from path instead
    const collectionId = collection.id ?? path.split("/").pop()

    //setting current value and secret values to of collection variables
    if (collection.variables) {
      const filteredVariables = pipe(
        collection.variables,
        A.filterMap(
          flow(
            O.fromPredicate((e) => e.key !== ""),
            O.map((e) => e)
          )
        )
      )

      const secretVariables = pipe(
        filteredVariables,
        A.filterMapWithIndex((i, e) =>
          e.secret
            ? O.some({
                key: e.key,
                value: e.currentValue,
                initialValue: e.initialValue,
                varIndex: i,
              })
            : O.none
        )
      )

      const nonSecretVariables = pipe(
        filteredVariables,
        A.filterMapWithIndex((i, e) =>
          !e.secret
            ? O.some({
                key: e.key,
                currentValue: e.currentValue,
                varIndex: i,
                isSecret: e.secret ?? false,
              })
            : O.none
        )
      )

      // Mirror the read-side keying in `editProperties`.
      const storeKey = collection._ref_id ?? collectionId!

      secretEnvironmentService.addSecretEnvironment(storeKey, secretVariables)

      currentEnvironmentValueService.addEnvironment(
        storeKey,
        nonSecretVariables
      )

      collection.variables = stripClientLocalValuesForWire(filteredVariables)
    }

    if (isRootCollection) {
      editRESTCollection(parseInt(path), collection)
    } else {
      editRESTFolder(path, collection)
    }

    nextTick(() => {
      updateInheritedPropertiesForAffectedRequests(path, "rest")
    })
    toast.success(t("collection.properties_updated"))

    return true
  }

  /**
   * Restores unsaved OAuth collection-properties after a redirect (REST flow).
   * Returns the state to open into, or null when nothing to restore.
   */
  const restoreOAuthCollectionProperties = async (): Promise<{
    properties: EditingProperties
  } | null> => {
    const localOAuthTempConfig =
      await persistenceService.getLocalConfig("oauth_temp_config")

    if (!localOAuthTempConfig) {
      return null
    }

    const { context, source, token, refresh_token }: PersistedOAuthConfig =
      JSON.parse(localOAuthTempConfig)

    if (source === "GraphQL") {
      return null
    }

    if (context?.type !== "collection-properties") {
      return null
    }

    // load the unsaved editing properties
    const unsavedCollectionPropertiesString =
      await persistenceService.getLocalConfig("unsaved_collection_properties")

    let unsavedCollectionProperties: EditingProperties | null = null

    if (unsavedCollectionPropertiesString) {
      unsavedCollectionProperties = JSON.parse(
        unsavedCollectionPropertiesString
      )

      const auth = unsavedCollectionProperties.collection?.auth

      if (auth?.authType === "oauth-2") {
        const grantTypeInfo = auth.grantTypeInfo

        grantTypeInfo && (grantTypeInfo.token = token ?? "")

        if (refresh_token && grantTypeInfo.grantType === "AUTHORIZATION_CODE") {
          grantTypeInfo.refreshToken = refresh_token
        }
      }
    }

    await persistenceService.removeLocalConfig("oauth_temp_config")

    if (!unsavedCollectionProperties) return null
    return { properties: unsavedCollectionProperties }
  }

  // ── Runner ──────────────────────────────────────────────────────

  const runCollectionHandler = (
    payload: CollectionRunnerData & {
      path?: string
    }
  ) => {
    collectionRunnerData.value = {
      type: "my-collections",
      collectionID: payload.collectionID,
    }
    showCollectionsRunnerModal.value = true
  }

  return {
    // shared loading / export / runner state
    modalLoadingState,
    exportLoading,
    showExportModal,
    showCollectionsRunnerModal,
    collectionRunnerData,
    myCollections,

    // helpers the component still needs for wiring
    setRequestTabResponses,

    // create
    createRootCollection,
    createRequest,
    createFolder,

    // tabs / selection
    openCollectionTab,
    editCollection,
    editFolder,
    selectRequest,
    selectResponse,

    // rename
    renameRequest,
    renameResponse,

    // duplicate
    duplicateCollection,
    duplicateRequest,
    duplicateResponse,

    // examples
    addExample,

    // remove
    removeRootCollection,
    removeFolder,
    removeRequest,
    removeResponse,

    // drag / reorder
    dropRequest,
    dropCollection,
    dropToRoot,
    updateRequestOrder,
    updateCollectionOrder,
    sortCollections,

    // import / export
    exportData,
    closeExportModal,
    onExportHopp,
    onExportOpenAPI,

    // properties / oauth / runner
    setCollectionProperties,
    restoreOAuthCollectionProperties,
    runCollectionHandler,
  }
}
