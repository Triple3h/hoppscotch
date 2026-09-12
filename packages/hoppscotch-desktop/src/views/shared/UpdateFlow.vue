<template>
  <div class="flex w-full flex-col items-center space-y-4">
    <IconLucideDownload class="h-16 w-16 text-accent" />

    <div class="text-center">
      <h2 class="text-xl font-semibold text-secondaryDark">Update Available</h2>
      <p v-if="latestVersion" class="mt-1 text-sm">
        <span class="text-secondaryLight">{{ currentVersion }}</span>
        <span class="mx-1.5 text-secondaryLight">&rarr;</span>
        <span class="font-medium text-accent">{{ latestVersion }}</span>
      </p>
      <p v-else class="text-secondary mt-1 text-sm">
        A new version of Hoppscotch is available
      </p>
    </div>

    <!--
      Release notes come from the (signature-verified) update manifest and are
      parsed into blocks so they read as a changelog rather than as raw
      markdown. Capped height keeps the window's buttons reachable no matter
      how long the notes are.
    -->
    <div
      v-if="noteBlocks.length > 0"
      class="max-h-56 w-full overflow-y-auto rounded-lg border border-dividerDark bg-primaryLight p-3 text-left"
    >
      <template v-for="(block, index) in noteBlocks" :key="index">
        <p
          v-if="block.kind === 'heading'"
          class="mb-1 mt-3 text-xs font-semibold tracking-wide text-secondaryLight uppercase first:mt-0"
        >
          <UpdateNoteText :spans="block.spans" />
        </p>
        <div v-else-if="block.kind === 'item'" class="flex space-x-2 py-0.5">
          <span class="bg-accent mt-1.5 h-1 w-1 shrink-0 rounded-full"></span>
          <span class="text-secondary text-sm">
            <UpdateNoteText :spans="block.spans" />
          </span>
        </div>
        <p v-else class="text-secondary py-0.5 text-sm">
          <UpdateNoteText :spans="block.spans" />
        </p>
      </template>
    </div>

    <div
      v-if="showProgress && progress && progress.total && progress.downloaded"
      class="w-full"
    >
      <div class="bg-primaryLight h-2.5 w-full rounded-full">
        <div
          class="bg-accent h-2.5 rounded-full transition-all duration-300"
          :style="{
            width: `${progress.percentage}%`,
          }"
        ></div>
      </div>
      <div class="text-secondaryLight mt-1 flex justify-between text-sm">
        <span>{{ Math.round(progress.percentage) }}%</span>
        <span class="text-sm">
          {{ formatBytes(progress.downloaded) }} /
          {{ formatBytes(progress.total) }}
        </span>
      </div>
    </div>

    <div
      v-else-if="showProgress && progress && progress.downloaded > 0"
      class="w-full"
    >
      <div class="bg-primaryLight h-2.5 w-full rounded-full">
        <div
          class="bg-accent h-2.5 w-full animate-pulse rounded-full"
          style="width: 100%"
        ></div>
      </div>
      <p class="text-secondaryLight mt-1 text-center text-sm">
        Downloaded {{ formatBytes(progress.downloaded) }}
      </p>
    </div>

    <div class="flex space-x-2">
      <HoppButtonPrimary
        v-if="state === 'available'"
        label="Install Update"
        :icon="IconLucideDownload"
        @click="$emit('install')"
      />
      <HoppButtonPrimary
        v-else-if="state === 'ready'"
        label="Restart Now"
        :icon="IconLucideRefreshCw"
        @click="$emit('restart')"
      />
      <HoppButtonSecondary
        v-if="state === 'available'"
        label="Later"
        outline
        @click="$emit('skip')"
      />
      <HoppButtonSecondary
        v-if="showCancel"
        label="Cancel"
        outline
        @click="$emit('cancel')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import IconLucideDownload from "~icons/lucide/download"
import IconLucideRefreshCw from "~icons/lucide/refresh-cw"
import type { DownloadProgress } from "~/services/updater.client"
import { parseUpdateNotes } from "~/utils/update-notes"
import UpdateNoteText from "./UpdateNoteText.vue"

interface Props {
  state: "available" | "downloading" | "installing" | "ready"
  currentVersion?: string
  latestVersion?: string
  notes?: string
  progress?: DownloadProgress
  showProgress?: boolean
  showCancel?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  currentVersion: "",
  latestVersion: "",
  notes: "",
  progress: undefined,
  showProgress: true,
  showCancel: false,
})

defineEmits<{
  install: []
  restart: []
  skip: []
  cancel: []
}>()

const noteBlocks = computed(() => parseUpdateNotes(props.notes))

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes"

  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}
</script>
