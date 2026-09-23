<template>
  <WorkspaceTabHeader
    v-model="requestName"
    badge-class="text-blue-500"
    :path="displayFolderPath"
    show-save-menu
    :placeholder="'Untitled'"
    @save="invokeAction('request-response.save')"
  >
    <template #badge-icon>
      <component
        :is="currentProtocolIcon"
        class="h-3.5 w-3.5"
        :class="isGQL ? 'text-accent' : 'text-blue-500'"
      />
    </template>
    <template #badge>{{ currentProtocolLabel }}</template>
    <template #save-menu="{ hide }">
      <HoppSmartItem
        :label="`${t('request.save_as')}`"
        :icon="IconFolderPlus"
        @click="
          () => {
            invokeAction('request.save-as')
            hide()
          }
        "
      />
    </template>
  </WorkspaceTabHeader>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useService } from "dioc/vue"
import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { invokeAction } from "~/helpers/actions"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { restCollections$ } from "~/newstore/collections"
import type { TabPathSegment } from "~/components/workspace/TabHeader.vue"
// Explicit import — unplugin-vue-components may not rewrite this on a live
// dev server, leaving runtime _resolveComponent blank.
import WorkspaceTabHeader from "~/components/workspace/TabHeader.vue"
import IconFolderPlus from "~icons/lucide/folder-plus"
import IconGlobe from "~icons/lucide/globe"
import IconGraphql from "~icons/hopp/graphql"

const t = useI18n()
const tabs = useService(WorkspaceTabsService)

const collections = useReadonlyStream(restCollections$, [])

const currentDoc = computed(() => tabs.currentActiveTab.value?.document)

const isGQL = computed(() => currentDoc.value?.type === "gql-request")

const currentProtocolLabel = computed(() => (isGQL.value ? "GraphQL" : "REST"))

const currentProtocolIcon = computed(() =>
  isGQL.value ? IconGraphql : IconGlobe
)

const requestName = computed({
  get: () => {
    const doc = currentDoc.value
    if (!doc) return ""
    if (doc.type === "request") return doc.request.name
    if (doc.type === "gql-request") return doc.request.name
    return ""
  },
  set: (value: string) => {
    const doc = currentDoc.value
    if (!doc) return
    if (doc.type === "request" || doc.type === "gql-request") {
      doc.request.name = value
    }
  },
})

const folderPath = computed<string[]>(() => {
  const doc = currentDoc.value
  if (!doc) return []

  const saveContext =
    doc.type === "request" || doc.type === "gql-request"
      ? doc.saveContext
      : null

  if (
    !saveContext ||
    saveContext.originLocation !== "user-collection" ||
    !saveContext.folderPath
  ) {
    return []
  }

  const indexPath = saveContext.folderPath
  const indexes = indexPath.split("/").map((x) => parseInt(x))

  const names: string[] = []
  const cols = collections.value

  if (indexes.length === 0 || !cols.length) return []

  let current = cols[indexes[0]]
  if (!current) return []
  names.push(current.name)

  for (let i = 1; i < indexes.length; i++) {
    const folder = current.folders[indexes[i]]
    if (!folder) break
    names.push(folder.name)
    current = folder
  }

  return names
})

// Deep paths collapse to `root > … > parent` with the hidden segments
// in the tooltip (same rules as the previous inline breadcrumb).
const displayFolderPath = computed<TabPathSegment[]>(() => {
  const path = folderPath.value
  if (path.length <= 3) {
    return path.map((segmentName) => ({
      name: segmentName,
      tooltip: segmentName,
    }))
  }
  return [
    { name: path[0], tooltip: path[0] },
    {
      name: "…",
      tooltip: path.slice(1, -1).join(" > "),
    },
    { name: path[path.length - 1], tooltip: path[path.length - 1] },
  ]
})
</script>
