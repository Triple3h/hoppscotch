<template>
  <div class="select-wrapper flex flex-col gap-2">
    <div>
      <p class="flex items-center">
        <span
          class="inline-flex items-center justify-center flex-shrink-0 mr-4 border-4 rounded-full border-primary text-dividerDark"
        >
          <icon-lucide-check-circle class="svg-icons" />
        </span>
        <span>
          {{ t(`action.choose_workspace`) }}
        </span>
      </p>
      <div class="pl-10">
        <select
          v-model="selectedWorkspaceID"
          autocomplete="off"
          class="select mt-2"
          autofocus
        >
          <option :key="undefined" :value="undefined" disabled selected>
            {{ t("action.select_workspace") }}
          </option>
          <option
            v-for="workspace in workspaces"
            :key="`workspace-${workspace.id}`"
            :value="workspace.id"
            class="bg-primary"
          >
            {{ workspace.name }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="showSelectCollections">
      <p class="flex items-center">
        <span
          class="inline-flex items-center justify-center flex-shrink-0 mr-4 border-4 rounded-full border-primary text-dividerDark"
        >
          <icon-lucide-check-circle class="svg-icons" />
        </span>
        <span>
          {{ t(`action.choose_collection`) }}
        </span>
      </p>
      <div class="pl-10">
        <select
          v-model="selectedCollectionID"
          autocomplete="off"
          class="select mt-2"
          autofocus
        >
          <option :key="undefined" :value="undefined" disabled selected>
            {{ t("collection.select") }}
          </option>
          <option
            v-for="collection in selectableCollections"
            :key="collection.id"
            :value="collection.id"
            class="bg-primary"
          >
            {{ collection.title }}
          </option>
        </select>
      </div>
    </div>
  </div>

  <div class="my-4">
    <HoppButtonPrimary
      class="w-full"
      :label="t('import.title')"
      :loading="loading"
      :disabled="!hasSelectedCollectionID || loading"
      @click="getCollectionDetailsAndImport"
    />
  </div>
</template>

<script setup lang="ts">
import { HoppCollection } from "@hoppscotch/data"
import { computed, ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { useReadonlyStream } from "~/composables/stream"
import { getRESTCollection, restCollections$ } from "~/newstore/collections"
import { useToast } from "~/composables/toast"

const t = useI18n()

defineProps<{
  loading: boolean
}>()

const selectedCollectionID = ref<string | undefined>(undefined)

const hasSelectedCollectionID = computed(() => {
  return selectedCollectionID.value !== undefined
})

const personalCollections = useReadonlyStream(restCollections$, [])

const selectedWorkspaceID = ref<string | undefined>("personal")

const selectableCollections = ref<
  {
    id: string
    title: string
    data?: string | null
  }[]
>([])

const toast = useToast()

watch(
  selectedWorkspaceID,
  async () => {
    // reset the selected collection when the workspace changes
    selectedCollectionID.value = undefined

    if (!selectedWorkspaceID.value) {
      // do some cleanup on the previous workspace selection
      selectableCollections.value = []

      return
    }

    selectableCollections.value = personalCollections.value.map(
      (collection, collectionIndex) => ({
        id: `${collectionIndex}`, // because we don't have an ID for personal collections
        title: collection.name,
      })
    )
  },
  {
    immediate: true,
  }
)

const emit = defineEmits<{
  (e: "importCollection", content: HoppCollection): void
}>()

const showSelectCollections = computed(() => {
  return !!selectedWorkspaceID.value
})

const workspaces = computed(() => {
  return [
    {
      id: "personal",
      name: t("workspace.personal"),
    },
  ]
})

const getCollectionDetailsAndImport = async () => {
  if (!selectedCollectionID.value) {
    return
  }

  let collectionToImport: HoppCollection

  if (selectedWorkspaceID.value === "personal") {
    collectionToImport = getRESTCollection(parseInt(selectedCollectionID.value))
  } else {
    toast.error(t("import.failed"))
    return
  }

  emit("importCollection", collectionToImport)
}
</script>
