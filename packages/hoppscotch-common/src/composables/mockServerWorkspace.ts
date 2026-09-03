import { watch } from "vue"
import { loadMockServers, setMockServers } from "~/newstore/mockServers"
import { platform } from "~/platform"
import { useMockServerVisibility } from "./mockServerVisibility"
import { useReadonlyStream } from "./stream"

/**
 * Composable to handle mock server state when auth or visibility changes.
 * This ensures mock servers are loaded/cleared when the user logs in or out
 * to prevent showing stale data. The app is personal-workspace-only, so there
 * is no workspace switching to react to.
 */
export function useMockServerWorkspaceSync() {
  const { isMockServerVisible } = useMockServerVisibility()

  const currentUser = useReadonlyStream(
    platform.auth.getCurrentUserStream(),
    platform.auth.getCurrentUser()
  )

  const loadServers = () => {
    if (!currentUser.value || !isMockServerVisible.value) return
    loadMockServers().catch(() => setMockServers([]))
  }

  // Load mock servers when authentication or visibility changes
  watch([currentUser, isMockServerVisible], loadServers, {
    immediate: true,
  })
}
