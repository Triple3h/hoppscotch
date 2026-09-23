<template>
  <div
    class="sticky top-0 z-20 flex items-center border-b border-dividerLight bg-primary px-4 py-2"
  >
    <!-- Static protocol prefix — quiet breadcrumb metadata (Postman-style),
         not a control. Protocol is chosen via the unified new-request entry. -->
    <div
      class="flex flex-shrink-0 items-center gap-1.5 border-r border-dividerLight pr-3 mr-3 text-xs font-medium tracking-wide text-secondary"
    >
      <component
        :is="currentProtocolIcon"
        class="h-3.5 w-3.5"
        :class="isGQL ? 'text-accent' : 'text-blue-500'"
      />
      <span
        class="font-semibold"
        :class="isGQL ? 'text-accent' : 'text-blue-500'"
      >
        {{ currentProtocolLabel }}
      </span>
    </div>

    <!-- Folder path + editable request name -->
    <div class="flex min-w-0 items-center">
      <template v-if="displayFolderPath.length > 0">
        <template v-for="(segment, i) in displayFolderPath" :key="i">
          <span
            v-tippy="{ theme: 'tooltip' }"
            :title="segment.tooltip"
            class="max-w-[10rem] flex-shrink-0 cursor-default truncate text-xs text-secondaryLight"
          >
            {{ segment.name }}
          </span>
          <component
            :is="IconChevronRight"
            class="mx-0.5 h-3.5 w-3.5 flex-shrink-0 text-secondaryLight opacity-50"
          />
        </template>
      </template>
      <HoppSmartInput
        v-model="requestName"
        :autofocus="false"
        styles=""
        input-styles="border border-transparent bg-transparent text-xs text-secondaryDark focus:border-divider focus:bg-primaryLight rounded px-2 py-0.5 outline-none transition-colors"
        placeholder="Untitled"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useService } from "dioc/vue"
import { useReadonlyStream } from "@composables/stream"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { restCollections$ } from "~/newstore/collections"
import IconChevronRight from "~icons/lucide/chevron-right"
import IconGlobe from "~icons/lucide/globe"
import IconGraphql from "~icons/hopp/graphql"

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

  // Walk the collection tree collecting names
  const names: string[] = []
  const cols = collections.value

  if (indexes.length === 0 || !cols.length) return []

  // First index is the root collection
  let current = cols[indexes[0]]
  if (!current) return []
  names.push(current.name)

  // Subsequent indexes traverse into folders
  for (let i = 1; i < indexes.length; i++) {
    const folder = current.folders[indexes[i]]
    if (!folder) break
    names.push(folder.name)
    current = folder
  }

  return names
})

// Every segment is width-capped (ellipsized by CSS),
// and deep paths collapse to `root > … > parent` with the hidden
// segments in the tooltip
const displayFolderPath = computed<{ name: string; tooltip: string }[]>(() => {
  const path = folderPath.value
  if (path.length <= 3) {
    return path.map((name) => ({ name, tooltip: name }))
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
