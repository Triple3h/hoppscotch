<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <WorkspaceTabHeader
      v-model="name"
      badge-class="text-blue-500"
      :path="displayFolderPath"
      :placeholder="t('action.label')"
      @save="saveCollection"
    >
      <template #badge-icon>
        <icon-lucide-folder
          class="h-3.5 w-3.5 text-blue-500"
          aria-hidden="true"
        />
      </template>
      <template #badge>
        {{ isRootCollection ? t("collection.title") : t("folder.heading") }}
      </template>
    </WorkspaceTabHeader>
    <CollectionsPropertiesTabs
      v-model:collection="editableCollection"
      v-model:active-tab="activeTab"
      :inherited-properties="doc.inheritedProperties"
      :collection-store-key="storeKey"
      :collection-path="doc.folderPath"
      :is-root-collection="doc.folderPath.split('/').length === 1"
      source="REST"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { useReadonlyStream } from "@composables/stream"
import { HoppCollection } from "@hoppscotch/data"
import { useService } from "dioc/vue"
import { computed, onMounted, ref, watch } from "vue"
import { defineActionHandler } from "~/helpers/actions"
import {
  EditableCollectionProperties,
  HoppCollectionAuth,
  HoppCollectionHeaders,
  collectionVariableStoreKey,
  persistCollectionProperties,
} from "~/helpers/collection/collectionProperties"
import { HoppCollectionDocument } from "~/helpers/tab/document"
import { restCollections$ } from "~/newstore/collections"
import { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import type { TabPathSegment } from "~/components/workspace/TabHeader.vue"
// Explicit import — unplugin-vue-components may not rewrite this on a live
// dev server, leaving runtime _resolveComponent blank.
import WorkspaceTabHeader from "~/components/workspace/TabHeader.vue"

const props = defineProps<{ modelValue: HoppTab<HoppCollectionDocument> }>()

const t = useI18n()
const toast = useToast()
const tabs = useService(WorkspaceTabsService)
const collections = useReadonlyStream(restCollections$, [])

// The document is mutated in place: the tab map is deeply reactive, so the
// tab head (name) and the dirty dot update without a round-trip through
// `update:modelValue`.
const doc = computed(() => props.modelValue.document)

const activeTab = ref("headers")

const storeKey = computed(() =>
  collectionVariableStoreKey(doc.value.collection, doc.value.folderPath)
)

const name = computed({
  get: () => doc.value.collection.name,
  set: (value: string) => (doc.value.collection.name = value),
})

// Root path is a single segment (e.g. "0"); deeper paths are folders
const isRootCollection = computed(
  () => doc.value.folderPath.split("/").length === 1
)

/**
 * Ancestor names for the breadcrumb (parents only — the editable name sits
 * after the last chevron, same as ProtocolSwitcher's request path + name).
 */
const folderPathNames = computed<string[]>(() => {
  const indexes = doc.value.folderPath
    .split("/")
    .map((x) => parseInt(x, 10))
    .filter((n) => !Number.isNaN(n))

  // Root collection: no ancestors
  if (indexes.length <= 1) return []

  const cols = collections.value
  if (!cols.length) return []

  const names: string[] = []
  let current = cols[indexes[0]]
  if (!current) return []
  names.push(current.name)

  // Walk parents of the edited node (exclude the node itself — last index)
  for (let i = 1; i < indexes.length - 1; i++) {
    const folder = current?.folders?.[indexes[i]]
    if (!folder) break
    names.push(folder.name)
    current = folder
  }

  return names
})

// Deep paths collapse to `root > … > parent` with the rest in the tooltip
const displayFolderPath = computed<TabPathSegment[]>(() => {
  const path = folderPathNames.value
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

// The panels edit the collection in place, so the document's collection *is*
// the draft — there is no second copy to keep in sync.
const editableCollection = computed<EditableCollectionProperties>({
  get: () => doc.value.collection as unknown as EditableCollectionProperties,
  set: (value) => {
    doc.value.collection = {
      ...doc.value.collection,
      ...value,
    } as HoppCollection
  },
})

/** Only the fields this tab owns — never `folders`, which may have moved on. */
const savePayload = (collection: HoppCollection) => ({
  name: collection.name,
  headers: collection.headers as HoppCollectionHeaders,
  auth: collection.auth as HoppCollectionAuth,
  variables: collection.variables ?? [],
  preRequestScript: collection.preRequestScript ?? "",
  testScript: collection.testScript ?? "",
})

const snapshot = (collection: HoppCollection) =>
  JSON.stringify(savePayload(collection))

// `null` until the stored state is known: a tab restored mid-edit keeps its
// dirty flag until it is saved.
const savedSnapshot = ref<string | null>(null)

onMounted(() => {
  if (!doc.value.isDirty) savedSnapshot.value = snapshot(doc.value.collection)
})

watch(
  () => snapshot(doc.value.collection),
  (current) => {
    if (savedSnapshot.value === null) return
    doc.value.isDirty = current !== savedSnapshot.value
  }
)

const saveCollection = () => {
  const { collection, folderPath } = doc.value

  if (!collection.name) {
    toast.error(t("collection.invalid_name"))
    return
  }

  // The path may have been reused (deleted/moved collection) while this tab
  // sat open — refuse to write into an unrelated collection.
  if (!persistCollectionProperties(folderPath, savePayload(collection))) {
    toast.error(t("error.something_went_wrong"))
    return
  }

  savedSnapshot.value = snapshot(collection)
  doc.value.isDirty = false
  toast.success(t("collection.properties_updated"))
}

defineActionHandler(
  "request-response.save",
  saveCollection,
  computed(() => tabs.currentActiveTab.value?.id === props.modelValue.id)
)
</script>
