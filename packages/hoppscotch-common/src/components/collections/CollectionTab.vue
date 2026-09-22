<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div
      class="flex flex-shrink-0 items-center gap-2 border-b border-dividerLight bg-primary px-4 py-1.5"
    >
      <icon-lucide-folder
        class="svg-icons flex-shrink-0 text-secondaryLight"
        aria-hidden="true"
      />
      <HoppSmartInput
        v-model="name"
        class="min-w-0 flex-1"
        input-styles="floating-input"
        :label="t('action.label')"
        @submit="saveCollection"
      />
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :title="t('action.save')"
        :label="t('action.save')"
        :icon="IconSave"
        outline
        filled
        @click="saveCollection"
      />
    </div>
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
import { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconSave from "~icons/lucide/save"

const props = defineProps<{ modelValue: HoppTab<HoppCollectionDocument> }>()

const t = useI18n()
const toast = useToast()
const tabs = useService(WorkspaceTabsService)

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
