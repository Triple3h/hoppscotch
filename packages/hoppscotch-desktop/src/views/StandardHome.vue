<template>
  <div
    class="flex flex-col items-center justify-center w-full h-screen bg-primary"
  >
    <div class="flex flex-col items-center space-y-6 max-w-md text-center">
      <AppHeader />

      <LoadingState
        v-if="appState === AppState.LOADING"
        :message="statusMessage"
      />

      <UpdateFlow
        v-else-if="
          appState === AppState.UPDATE_AVAILABLE ||
          appState === AppState.UPDATE_IN_PROGRESS ||
          appState === AppState.UPDATE_READY
        "
        :state="updateFlowState"
        :current-version="updateInfo?.currentVersion"
        :latest-version="updateInfo?.latestVersion"
        :notes="updateInfo?.releaseNotes"
        :progress="downloadProgress"
        :show-progress="true"
        :show-cancel="appState === AppState.UPDATE_AVAILABLE"
        @install="installUpdate"
        @restart="restartApp"
        @skip="skipUpdate"
        @cancel="cancelUpdate"
      />

      <ErrorState
        v-else-if="appState === AppState.ERROR"
        :error="error"
        @retry="initialize"
      />

      <VersionInfo :version="appVersion" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"

import {
  useAppInitialization,
  AppState,
} from "~/composables/useAppInitialization"
import {
  UpdaterClient,
  type UpdateEvent,
  type DownloadProgress,
  type UpdateInfo,
} from "~/services/updater.client"
import { DesktopPersistenceService } from "~/services/persistence.service"

import AppHeader from "./shared/AppHeader.vue"
import LoadingState from "./shared/LoadingState.vue"
import UpdateFlow from "./shared/UpdateFlow.vue"
import ErrorState from "./shared/ErrorState.vue"
import VersionInfo from "./shared/VersionInfo.vue"

const { appState, error, statusMessage, appVersion, loadRecent, initialize } =
  useAppInitialization()

const updaterClient = new UpdaterClient()

const updateInfo = ref<UpdateInfo | null>(null)
const downloadProgress = ref<DownloadProgress>({
  downloaded: 0,
  total: undefined,
  percentage: 0,
})

const updateFlowState = computed(() => {
  switch (appState.value) {
    case AppState.UPDATE_AVAILABLE:
      return "available"
    case AppState.UPDATE_IN_PROGRESS:
      return downloadProgress.value.percentage < 100
        ? "downloading"
        : "installing"
    case AppState.UPDATE_READY:
      return "ready"
    default:
      return "available"
  }
})

const installUpdate = async () => {
  try {
    appState.value = AppState.UPDATE_IN_PROGRESS
    await updaterClient.downloadAndInstall()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    error.value = `Failed to install update: ${errorMessage}`
    appState.value = AppState.ERROR
  }
}

const skipUpdate = async () => {
  await loadRecent()
}

const restartApp = async () => {
  try {
    await updaterClient.restart()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    error.value = `Failed to restart app: ${errorMessage}`
    appState.value = AppState.ERROR
  }
}

const cancelUpdate = async () => {
  try {
    await updaterClient.cancel()
    await loadRecent()
  } catch (err) {
    console.error("Failed to cancel update:", err)
    await loadRecent()
  }
}

const checkForUpdates = async () => {
  try {
    statusMessage.value = "Checking for updates..."
    const info = await updaterClient.checkForUpdates(false)

    if (info.available) {
      console.log("Updates available (standard)")
      updateInfo.value = info
      appState.value = AppState.UPDATE_AVAILABLE
      return true
    }

    updateInfo.value = null
    return false
  } catch (err) {
    console.error("Error checking for updates:", err)
    // NOTE: No need to show error for update check failures, just continue,
    // because `check()` tends to fail quite often due to inexplicable reasons,
    // `updater.rs` is far more stable options so continuing will
    // let the Rust side handle this.
    return false
  }
}

const initializeStandardMode = async () => {
  // The settings page's `disableUpdateChecks` toggle governs the automatic
  // startup check, not the manual "Check for updates" button in settings.
  // Reading the setting here lets air-gapped and enterprise-network users
  // skip the 5-second timeout retry on every launch. They can still trigger
  // a check on demand from the settings page whenever they want.
  const persistence = DesktopPersistenceService.getInstance()
  const settings = await persistence.desktopSettings.get()

  if (!settings.disableUpdateChecks) {
    const hasUpdates = await checkForUpdates()
    if (hasUpdates) {
      return
    }
  }

  await loadRecent()
}

onMounted(async () => {
  await updaterClient.listenToUpdates((event: UpdateEvent) => {
    switch (event.type) {
      case "DownloadProgress":
        downloadProgress.value = event.progress
        break
      case "DownloadCompleted":
        appState.value = AppState.UPDATE_IN_PROGRESS
        break
      case "RestartRequired":
        appState.value = AppState.UPDATE_READY
        break
      case "Error":
        error.value = event.message
        appState.value = AppState.ERROR
        break
    }
  })

  await initialize(initializeStandardMode)
})

onUnmounted(() => {
  updaterClient.stopListening()
})
</script>
