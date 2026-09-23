import { computed, nextTick, ref } from "vue"
import { useService } from "dioc/vue"
import { generateUniqueRefId, type HoppRESTRequest } from "@hoppscotch/data"
import { cloneDeep } from "lodash-es"
import type { WorkspaceTabMenuEntry } from "~/components/workspace/AllTabsMenu.vue"
import { invokeAction } from "~/helpers/actions"
import type { HoppTabDocument } from "~/helpers/tab/document"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { InspectionService } from "~/services/inspection"
import type { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service"
import { ScrollService } from "~/services/scroll.service"

/**
 * Narrow UI facade over WorkspaceTabsService for the unified workspace
 * tab bar: read state (active tabs, labels, menu entries) plus tab
 * commands (add/switch/reorder/close/rename/duplicate/navigation) and
 * their dirty-close confirmation flows. Page shells bind this — not the
 * full service — so tab-bar changes stay contained.
 */
export function useTabBar() {
  const tabs = useService(WorkspaceTabsService)
  const scrollService = useService(ScrollService)
  const gqlTabConn = useService(GQLTabConnectionService)
  const inspectionService = useService(InspectionService)

  const currentTabID = tabs.currentTabID
  const activeTabs = tabs.getActiveTabs()

  // --- dirty-close (single tab) + save-request modal state ---
  const confirmingCloseForTabID = ref<string | null>(null)
  const savingRequest = ref(false)

  // --- close-others confirmation state ---
  const confirmingCloseAllTabs = ref(false)
  const unsavedTabsCount = ref(0)
  const exceptedTabID = ref<string | null>(null)

  // --- rename modal state ---
  const showRenamingReqNameModal = ref(false)
  const reqName = ref<string>("")
  const renameTabID = ref<string | null>(null)

  const getTabName = (tab: HoppTab<HoppTabDocument>) => {
    if (tab.document.type === "request") {
      return tab.document.request?.name ?? "Untitled"
    } else if (tab.document.type === "gql-request") {
      return tab.document.request?.name ?? "Untitled"
    } else if (tab.document.type === "test-runner") {
      return tab.document.collection?.name ?? "Untitled"
    } else if (tab.document.type === "example-response") {
      return tab.document.response?.name ?? "Untitled"
    } else if (tab.document.type === "gql-example-response") {
      return tab.document.response?.name ?? "Untitled"
    } else if (tab.document.type === "collection") {
      return tab.document.collection?.name ?? "Untitled"
    } else if (tab.document.type === "environment") {
      return tab.document.name || "Untitled"
    }

    return "Unnamed tab"
  }

  /** Flatten every workspace tab (incl. folder/env/test-runner) for the left menu. */
  const tabMenuEntries = computed<WorkspaceTabMenuEntry[]>(() =>
    activeTabs.value.map((tab) => {
      const base = {
        id: tab.id,
        name: getTabName(tab),
        isDirty: "isDirty" in tab.document ? tab.document.isDirty : false,
      }

      switch (tab.document.type) {
        case "request":
          return {
            ...base,
            kind: "request" as const,
            method: tab.document.request.method,
            detail: tab.document.request.endpoint,
          }
        case "example-response":
          return {
            ...base,
            kind: "example" as const,
            method: tab.document.response.originalRequest.method,
            detail: tab.document.response.originalRequest.endpoint,
          }
        case "gql-request":
          return {
            ...base,
            kind: "gql" as const,
            detail: tab.document.request.url,
          }
        case "gql-example-response":
          return {
            ...base,
            kind: "gql-example" as const,
            detail: tab.document.response.originalRequest.url,
          }
        case "collection":
          return { ...base, kind: "collection" as const }
        case "environment":
          return { ...base, kind: "environment" as const }
        case "test-runner":
          return {
            ...base,
            kind: "test-runner" as const,
            detail: tab.document.collection.name,
          }
        default:
          return { ...base, kind: "other" as const }
      }
    })
  )

  const setActiveTab = (tabID: string) => {
    tabs.setActiveTab(tabID)
  }

  const addNewTab = () => {
    const tab = tabs.createNewTab({
      type: "request",
      request: getDefaultRESTRequest(),
      isDirty: false,
    })
    tabs.setActiveTab(tab.id)
  }

  const sortTabs = (e: { oldIndex: number; newIndex: number }) => {
    tabs.updateTabOrdering(e.oldIndex, e.newIndex)
  }

  const onTabUpdate = (tab: HoppTab<HoppTabDocument>) => {
    tabs.updateTab(tab)
  }

  /**
   * Close `tabID` if the service accepts it, then tear down per-tab
   * side effects (scroll cache, GQL poll/socket, inspector results).
   * Refused for the last open tab — no cleanup in that case.
   */
  const closeTabAndCleanup = (tabID: string): boolean => {
    const tabState = tabs.getTabRef(tabID).value
    if (!tabs.closeTab(tabID)) return false
    scrollService.cleanupScrollForTab(tabID)
    if (tabState?.document.type === "gql-request") {
      gqlTabConn.cleanupTab(tabID)
    }
    inspectionService.deleteTabInspectorResult(tabID)
    return true
  }

  const removeTab = (tabID: string) => {
    const tabState = tabs.getTabRef(tabID).value

    if (tabState.document.isDirty) {
      confirmingCloseForTabID.value = tabID
    } else {
      closeTabAndCleanup(tabState.id)
    }
  }

  // Tear down GQL connections (the 7s schema-poll timer, any open subscription
  // socket, and the per-tab context maps) for every tab `closeOtherTabs` is
  // about to discard — it only removes them from the tab map, so without this
  // each dropped gql-request tab leaks its poll loop and socket. Mirrors the
  // single-tab cleanup in `removeTab`; `cleanupTab` is idempotent.
  const cleanupDiscardedTabs = (keepTabID: string) => {
    for (const tab of tabs.getTabs()) {
      if (tab.id === keepTabID) continue
      if (tab.document.type === "gql-request") {
        gqlTabConn.cleanupTab(tab.id)
      }
      inspectionService.deleteTabInspectorResult(tab.id)
    }
  }

  const closeOtherTabsAction = (tabID: string) => {
    const isTabDirty = tabs.getTabRef(tabID).value?.document.isDirty
    const dirtyTabCount = tabs.getDirtyTabsCount()
    // If current tab is dirty, so we need to subtract 1 from the dirty tab count
    const balanceDirtyTabCount = isTabDirty ? dirtyTabCount - 1 : dirtyTabCount

    // If there are dirty tabs, show the confirm modal
    if (balanceDirtyTabCount > 0) {
      confirmingCloseAllTabs.value = true
      unsavedTabsCount.value = balanceDirtyTabCount
      exceptedTabID.value = tabID
    } else {
      scrollService.cleanupAllScroll(tabID)
      cleanupDiscardedTabs(tabID)
      tabs.closeOtherTabs(tabID)
    }
  }

  const onResolveConfirmCloseAllTabs = () => {
    if (exceptedTabID.value) {
      scrollService.cleanupAllScroll(exceptedTabID.value)
      cleanupDiscardedTabs(exceptedTabID.value)
      tabs.closeOtherTabs(exceptedTabID.value)
    }
    confirmingCloseAllTabs.value = false
  }

  const duplicateTab = (tabID: string) => {
    const tab = tabs.getTabRef(tabID)
    if (tab.value && tab.value.document.type === "request") {
      const newTab = tabs.createNewTab({
        type: "request",
        request: {
          ...cloneDeep(tab.value.document.request),
          _ref_id: generateUniqueRefId("req"),
        },
        isDirty: true,
      })
      tabs.setActiveTab(newTab.id)
    } else if (tab.value && tab.value.document.type === "gql-request") {
      const doc = tab.value.document
      const newTab = tabs.createNewTab({
        type: "gql-request",
        request: {
          ...cloneDeep(doc.request),
          _ref_id: generateUniqueRefId("req"),
        },
        isDirty: true,
        cursorPosition: doc.cursorPosition ?? 0,
        // Like REST duplicates: no inheritedProperties (the copy is detached
        // from the source collection, `inherit` resolves to none until saved)
        // and no response/sub-tab preference
      })
      tabs.setActiveTab(newTab.id)
    }
  }

  const requestToRename = computed(() => {
    if (!renameTabID.value) return null
    const tab = tabs.getTabRef(renameTabID.value)

    if (tab.value.document.type === "request") {
      return tab.value.document.request
    } else if (tab.value.document.type === "gql-request") {
      return tab.value.document.request
    }
    return null
  })

  const openReqRenameModal = (tabID?: string) => {
    if (tabID) {
      const tab = tabs.getTabRef(tabID)
      const docType = tab.value.document.type

      if (docType !== "request" && docType !== "gql-request") return

      reqName.value = tab.value.document.request.name
      renameTabID.value = tabID
    } else {
      const { id, document } = tabs.currentActiveTab.value

      if (document.type !== "request" && document.type !== "gql-request") return

      reqName.value = document.request.name
      renameTabID.value = id
    }
    showRenamingReqNameModal.value = true
  }

  const renameReqName = () => {
    const tab = tabs.getTabRef(renameTabID.value ?? currentTabID.value)
    if (
      tab.value &&
      (tab.value.document.type === "request" ||
        tab.value.document.type === "gql-request")
    ) {
      tab.value.document.request.name = reqName.value
      tabs.updateTab(tab.value)
    }
    showRenamingReqNameModal.value = false
  }

  /**
   * This function is closed when the confirm tab is closed by some means (even saving triggers close)
   */
  const onCloseConfirmSaveTab = () => {
    if (!savingRequest.value && confirmingCloseForTabID.value) {
      closeTabAndCleanup(confirmingCloseForTabID.value)
      confirmingCloseForTabID.value = null
    }
  }

  /**
   * Called when the user confirms they want to save the tab
   */
  const onResolveConfirmSaveTab = async () => {
    const closingTabID = confirmingCloseForTabID.value
    if (!closingTabID) return

    const tabState = tabs.getTabRef(closingTabID).value

    // Both save paths (the `request-response.save` handler and the Save As
    // modal) act on the active tab, so the tab being closed has to be focused
    // first — closing a dirty background tab would otherwise save the active
    // one. `nextTick` lets the newly active tab mount and bind its handler.
    if (currentTabID.value !== closingTabID) {
      tabs.setActiveTab(closingTabID)
      await nextTick()
    }

    // `HoppTabDocument` is a union — test-runner documents carry no
    // `saveContext`, so probe for the key instead of assuming it exists.
    const saveContext =
      "saveContext" in tabState.document
        ? tabState.document.saveContext
        : undefined

    if (!saveContext) {
      savingRequest.value = true
      return
    }

    invokeAction("request-response.save")

    closeTabAndCleanup(closingTabID)
    confirmingCloseForTabID.value = null
  }

  /**
   * Called when the Save Request modal is done and is closed
   */
  const onSaveModalClose = () => {
    savingRequest.value = false
    if (confirmingCloseForTabID.value) {
      closeTabAndCleanup(confirmingCloseForTabID.value)
      confirmingCloseForTabID.value = null
    }
  }

  // Always "workspace" — on the unified page every save goes through
  // WorkspaceTabsService, for both REST and GQL documents.
  const saveRequestMode = computed(() => "workspace" as const)

  /** Open a document in a new workspace tab (action handlers, deep links). */
  const openDocument = (doc: HoppTabDocument) => {
    tabs.createNewTab(doc)
  }

  /**
   * Replace the active REST request (URL-param deep link). No-op when the
   * active tab is not a REST request document.
   */
  const patchActiveRestRequest = (
    patch: (request: HoppRESTRequest) => HoppRESTRequest
  ) => {
    const doc = tabs.currentActiveTab.value.document
    if (doc.type !== "request") return
    doc.request = patch(doc.request)
  }

  return {
    // read state
    currentTabID,
    activeTabs,
    getTabName,
    tabMenuEntries,
    requestToRename,
    // rename
    reqName,
    showRenamingReqNameModal,
    openReqRenameModal,
    renameReqName,
    // dirty-close / close-others / save-modal state
    confirmingCloseForTabID,
    confirmingCloseAllTabs,
    unsavedTabsCount,
    savingRequest,
    saveRequestMode,
    // commands
    setActiveTab,
    addNewTab,
    sortTabs,
    removeTab,
    closeOtherTabsAction,
    duplicateTab,
    onTabUpdate,
    onCloseConfirmSaveTab,
    onResolveConfirmSaveTab,
    onSaveModalClose,
    onResolveConfirmCloseAllTabs,
    openDocument,
    patchActiveRestRequest,
    // navigation (keyboard / action handlers)
    goToNextTab: () => tabs.goToNextTab(),
    goToPreviousTab: () => tabs.goToPreviousTab(),
    goToFirstTab: () => tabs.goToFirstTab(),
    goToLastTab: () => tabs.goToLastTab(),
    reopenClosedTab: () => tabs.reopenClosedTab(),
    goToMRUTab: () => tabs.goToMRUTab(),
    goToPreviousMRUTab: () => tabs.goToPreviousMRUTab(),
  }
}
