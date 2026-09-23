import { computed } from "vue"
import { useService } from "dioc/vue"
import type { HoppTabDocument } from "~/helpers/tab/document"
import type { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"

/**
 * Narrow UI facade over WorkspaceTabsService for request/gql/env panels.
 * Non-UI services (persistence, spotlight, collections helpers, …) keep
 * binding WorkspaceTabsService directly.
 */
export function useRequestTab() {
  const tabs = useService(WorkspaceTabsService)

  return {
    /** Reactive id of the active workspace tab. */
    tabID: tabs.currentTabID,
    /** Reactive document held by the active workspace tab. */
    document: computed(() => tabs.currentActiveTab.value?.document),
    /** Open a new workspace tab (switches to it unless told otherwise). */
    create: (
      document: HoppTabDocument,
      switchToIt = true
    ): HoppTab<HoppTabDocument> => tabs.createNewTab(document, switchToIt),
    /** Close a workspace tab by id; false when it is the last tab. */
    close: (tabID: string): boolean => tabs.closeTab(tabID),
    /** Snapshot of all open tabs. */
    activeTabs: tabs.getActiveTabs(),
  }
}
