import { computed } from "vue"
import { useService } from "dioc/vue"
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service"
import { GQLTabService } from "~/services/tab/graphql"

/**
 * Resolves the schema for the GQL UI currently on screen.
 *
 * Prefers `GQLTabConnectionService.activeTabSchema`, which tracks the unified
 * workspace's WorkspaceTabsService. Falls back to the legacy /graphql page's
 * GQLTabService active tab (that service is not visible to activeGQLTabId),
 * reading the same per-tab connection context by tab id.
 */
export function useActiveSchema() {
  const gqlTabConn = useService(GQLTabConnectionService)
  const legacyTabs = useService(GQLTabService)

  const activeTabId = computed(
    () =>
      gqlTabConn.activeGQLTabId.value ||
      legacyTabs.currentActiveTab.value?.id ||
      ""
  )

  const schema = computed(() => {
    const fromWorkspace = gqlTabConn.activeTabSchema.value
    if (fromWorkspace) return fromWorkspace
    const legacyId = legacyTabs.currentActiveTab.value?.id
    if (!legacyId) return null
    return gqlTabConn.getTabConnectionState(legacyId).schema
  })

  return { activeTabId, schema }
}
