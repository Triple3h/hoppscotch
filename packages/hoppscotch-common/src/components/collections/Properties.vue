<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="t('collection.properties')"
    :full-width-body="true"
    styles="sm:max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[80vw]"
    @close="hideModal"
  >
    <template #body>
      <CollectionsPropertiesTabs
        v-model:collection="editableCollection"
        v-model:active-tab="activeTab"
        :inherited-properties="editingProperties.inheritedProperties"
        :collection-store-key="editingProperties.collectionStoreKey"
        :collection-path="editingProperties.path"
        :is-root-collection="editingProperties.isRootCollection"
        :source="source"
        :show-details="showDetails"
        tabs-styles="sticky overflow-x-auto flex-shrink-0 bg-primary top-0 z-10 !-py-4"
      />
    </template>
    <template #footer>
      <div class="flex gap-x-2">
        <HoppButtonPrimary
          v-if="activeTabIsDetails"
          :label="t('action.copy')"
          :icon="copyIcon"
          outline
          filled
          @click="copyCollectionID"
        />
        <HoppButtonPrimary
          v-else
          :label="t('action.save')"
          :loading="loadingState"
          outline
          @click="saveEditedCollection"
        />

        <HoppButtonSecondary
          :label="activeTabIsDetails ? t('action.close') : t('action.cancel')"
          outline
          filled
          @click="hideModal"
        />
      </div>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { refAutoReset, useVModel } from "@vueuse/core"
import { computed, ref, watch } from "vue"
import { useI18n } from "@composables/i18n"
import { useToast } from "~/composables/toast"
import { useService } from "dioc/vue"
import { clone } from "lodash-es"
import { copyToClipboard } from "~/helpers/utils/clipboard"
import { HoppCollection } from "@hoppscotch/data"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { PersistenceService } from "~/services/persistence"
import {
  EditableCollectionProperties,
  makeEditableCollection,
} from "~/helpers/collection/collectionProperties"

import IconCheck from "~icons/lucide/check"
import IconCopy from "~icons/lucide/copy"

const persistenceService = useService(PersistenceService)
const t = useI18n()
const toast = useToast()

export type EditingProperties = {
  collection: Partial<HoppCollection> | null
  isRootCollection: boolean
  path: string
  inheritedProperties?: HoppInheritedProperty
  // Key the collection's secret/current values are stored under, computed
  // authoritatively by `editProperties`.
  collectionStoreKey?: string
}

const props = withDefaults(
  defineProps<{
    show: boolean
    loadingState?: boolean
    editingProperties: EditingProperties
    source: "REST" | "GraphQL"
    modelValue: string
    showDetails?: boolean
  }>(),
  {
    show: false,
    loadingState: false,
    showDetails: false,
  }
)

const emit = defineEmits<{
  (
    e: "set-collection-properties",
    newCollection: Omit<EditingProperties, "inheritedProperties">
  ): void
  (e: "hide-modal"): void
  (e: "update:modelValue"): void
}>()

const editableCollection = ref<EditableCollectionProperties>(
  makeEditableCollection({})
)

const copyIcon = refAutoReset<typeof IconCopy | typeof IconCheck>(
  IconCopy,
  1000
)
const activeTab = useVModel(props, "modelValue", emit)

const activeTabIsDetails = computed(() => activeTab.value === "details")

const persistUnsavedChanges = async (updated: EditableCollectionProperties) => {
  if (!props.show) return
  await persistenceService.setLocalConfig(
    "unsaved_collection_properties",
    JSON.stringify({
      collection: updated,
      isRootCollection: props.editingProperties.isRootCollection ?? false,
      path: props.editingProperties.path,
      inheritedProperties: props.editingProperties.inheritedProperties,
      collectionStoreKey: props.editingProperties.collectionStoreKey,
    })
  )
}

const handleModalVisibility = async (show: boolean) => {
  enforceTabAccessRules()

  if (show && props.editingProperties.collection) {
    loadEditableCollection()
  } else {
    resetEditableCollection()
    await persistenceService.removeLocalConfig("unsaved_collection_properties")
  }
}

const enforceTabAccessRules = () => {
  // `Details` tab doesn't exist for personal workspace, hence switching to the `Headers` tab
  if (activeTab.value === "details" && !props.showDetails)
    activeTab.value = "headers"
  // `Scripts` tab only exists for REST collections
  // Switch to `Variables` tab if scripts tab becomes unavailable
  if (activeTab.value === "scripts" && props.source !== "REST")
    activeTab.value = "variables"
}

const loadEditableCollection = () => {
  editableCollection.value = makeEditableCollection(
    props.editingProperties.collection!
  )
}

const resetEditableCollection = () => {
  editableCollection.value = makeEditableCollection({})
}

const saveEditedCollection = async () => {
  if (!props.editingProperties) return
  emit("set-collection-properties", {
    path: props.editingProperties.path,
    collection: {
      ...props.editingProperties.collection,
      ...clone(editableCollection.value),
    },
    isRootCollection: props.editingProperties.isRootCollection,
  } as EditingProperties)
  await persistenceService.removeLocalConfig("unsaved_collection_properties")
}

watch(editableCollection, persistUnsavedChanges, { deep: true })
watch(() => props.show, handleModalVisibility)

const hideModal = async () => {
  await persistenceService.removeLocalConfig("unsaved_collection_properties")
  emit("hide-modal")
}

const copyCollectionID = () => {
  copyToClipboard(props.editingProperties.path)
  copyIcon.value = IconCheck
  toast.success(t("state.copied_to_clipboard"))
}
</script>
