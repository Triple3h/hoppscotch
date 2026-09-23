<template>
  <div
    :class="{
      'rounded border border-divider': saveRequest,
      'bg-primaryDark':
        draggingToRoot && currentReorderingStatus.type !== 'request',
    }"
    class="flex-1"
    @drop.prevent="dropToRoot"
    @dragover.prevent="draggingToRoot = true"
    @dragend="draggingToRoot = false"
  >
    <div
      class="sticky z-10 flex flex-shrink-0 flex-col overflow-x-auto bg-primary border-b border-dividerLight"
      :class="{ 'rounded-t': saveRequest }"
      :style="
        saveRequest ? 'top: calc(-1 * var(--line-height-body))' : 'top: 0'
      "
    >
      <WorkspaceCurrent :section="t('tab.collections')" />
      <input
        v-model="filterTexts"
        type="search"
        autocomplete="off"
        class="flex w-full bg-transparent px-4 py-2 h-8"
        :placeholder="t('action.search')"
      />
    </div>
    <!-- ponytail: MyCollections' 20+ emits are intentionally NOT narrowed yet —
         side effects already live in useCollectionActions; command-event merge
         is the next cut. -->
    <CollectionsMyCollections
      :collections-type="collectionsType"
      :filtered-collections="filteredCollections"
      :filter-text="filterTexts"
      :save-request="saveRequest"
      :picked="picked"
      @run-collection="
        runCollectionHandler({
          type: 'my-collections',
          collectionID: $event.collection._ref_id,
          collectionIndex: $event.collectionIndex,
        })
      "
      @add-folder="addFolder"
      @add-request="addRequest"
      @add-gql-request="addGqlRequest"
      @edit-request="editRequest"
      @edit-collection="editCollection"
      @edit-folder="editFolder"
      @edit-response="editResponse"
      @drop-request="dropRequest"
      @drop-collection="dropCollection"
      @display-modal-add="displayModalAdd(true)"
      @display-modal-import-export="
        displayModalImportExport(true, 'my-collections')
      "
      @duplicate-collection="duplicateCollection"
      @duplicate-request="duplicateRequest"
      @duplicate-response="duplicateResponse"
      @export-data="exportData"
      @remove-collection="removeCollection"
      @remove-folder="removeFolder"
      @remove-request="removeRequest"
      @remove-response="removeResponse"
      @add-example="addExample"
      @select="selectPicked"
      @select-response="selectResponse"
      @select-request="selectRequest"
      @sort-collections="sortCollections"
      @update-request-order="updateRequestOrder"
      @update-collection-order="updateCollectionOrder"
    />
    <div
      class="py-15 hidden flex-1 flex-col items-center justify-center bg-primaryDark px-4 text-secondaryLight"
      :class="{
        '!flex': draggingToRoot && currentReorderingStatus.type !== 'request',
      }"
    >
      <icon-lucide-list-end class="svg-icons !h-8 !w-8" />
    </div>
    <CollectionsAdd
      :show="showModalAdd"
      :loading-state="modalLoadingState"
      @submit="addNewRootCollection"
      @hide-modal="displayModalAdd(false)"
    />
    <CollectionsAddRequest
      :show="showModalAddRequest"
      :loading-state="modalLoadingState"
      :request-type="requestTypeToAdd"
      @add-request="onAddRequest"
      @hide-modal="displayModalAddRequest(false)"
    />
    <CollectionsAddFolder
      :show="showModalAddFolder"
      :loading-state="modalLoadingState"
      @add-folder="onAddFolder"
      @hide-modal="displayModalAddFolder(false)"
    />
    <CollectionsEditRequest
      v-model="editingRequestName"
      :show="showModalEditRequest"
      :request-context="editingRequest"
      :loading-state="modalLoadingState"
      @submit="updateEditingRequest"
      @hide-modal="displayModalEditRequest(false)"
    />
    <CollectionsEditResponse
      v-model="editingResponseName"
      :show="showModalEditResponse"
      :request-context="editingRequest"
      :loading-state="modalLoadingState"
      @submit="updateEditingResponse"
      @hide-modal="displayModalEditResponse(false)"
    />
    <HoppSmartModal
      v-if="showAddExampleModal"
      dialog
      :title="t('action.add_example')"
      @close="displayModalAddExample(false)"
    >
      <template #body>
        <div class="flex gap-1">
          <HoppSmartInput
            v-model="editingResponseName"
            class="flex-grow"
            placeholder=" "
            :label="t('action.label')"
            input-styles="floating-input !border-0"
            styles="border border-divider rounded"
            @submit="onAddExample"
          />
        </div>
      </template>
      <template #footer>
        <span class="flex space-x-2">
          <HoppButtonPrimary
            :label="t('action.add')"
            :loading="modalLoadingState"
            outline
            @click="onAddExample"
          />
          <HoppButtonSecondary
            :label="t('action.cancel')"
            outline
            filled
            @click="displayModalAddExample(false)"
          />
        </span>
      </template>
    </HoppSmartModal>
    <CollectionsExportFormatModal
      :show="showExportModal"
      :loading="exportLoading"
      @close="closeExportModal"
      @export-hoppscotch="onExportHopp"
      @export-openapi="onExportOpenAPI"
    />
    <HoppSmartConfirmModal
      :show="showConfirmModal"
      :title="confirmModalTitle"
      :loading-state="modalLoadingState"
      @hide-modal="showConfirmModal = false"
      @resolve="resolveConfirmModal"
    />

    <CollectionsImportExport
      v-if="showModalImportExport"
      :collections-type="collectionsType"
      @hide-modal="displayModalImportExport(false)"
    />

    <CollectionsProperties
      v-model="collectionPropertiesModalActiveTab"
      :show="showModalEditProperties"
      :editing-properties="editingProperties"
      source="REST"
      @hide-modal="displayModalEditProperties(false)"
      @set-collection-properties="setCollectionProperties"
    />
    <!-- `selectedCollectionID` is guaranteed to be a string when `showCollectionsRunnerModal` is `true` -->
    <HttpTestRunnerModal
      v-if="showCollectionsRunnerModal && collectionRunnerData"
      :collection-runner-data="collectionRunnerData"
      @hide-modal="showCollectionsRunnerModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import {
  HoppCollection,
  HoppGQLRequest,
  HoppRESTRequest,
  isGQLRequest,
} from "@hoppscotch/data"
import { computed, onMounted, ref, type PropType } from "vue"
import { useReadonlyStream } from "~/composables/stream"
import { useCollectionActions } from "~/composables/useCollectionActions"
import { defineActionHandler } from "~/helpers/actions"
import { handleTokenValidation } from "~/helpers/handleTokenValidation"
import { currentReorderingStatus$ } from "~/newstore/reordering"
import { Picked } from "~/helpers/types/HoppPicked"
import { RESTOptionTabs } from "../http/RequestOptions.vue"
import { EditingProperties } from "./Properties.vue"
import { restCollections$ } from "~/newstore/collections"

const t = useI18n()
const toast = useToast()

const actions = useCollectionActions()
const {
  modalLoadingState,
  exportLoading,
  showExportModal,
  showCollectionsRunnerModal,
  collectionRunnerData,
  editCollection,
  editFolder,
  selectRequest,
  selectResponse,
  duplicateCollection,
  duplicateRequest,
  duplicateResponse,
  exportData,
  closeExportModal,
  onExportHopp,
  onExportOpenAPI,
  sortCollections,
  updateRequestOrder,
  updateCollectionOrder,
  runCollectionHandler,
} = actions

const props = defineProps({
  saveRequest: {
    type: Boolean,
    default: false,
    required: false,
  },
  picked: {
    type: Object as PropType<Picked | null>,
    default: null,
    required: false,
  },
})

const emit = defineEmits<{
  (event: "select", payload: Picked | null): void
}>()

const collectionsType = {
  type: "my-collections" as const,
  selectedTeam: undefined,
}

// Pure UI state: editing targets for modals, rename inputs, modal flags.
const editingCollection = ref<HoppCollection | null>(null)
const editingCollectionIndex = ref<number | null>(null)
const editingCollectionID = ref<string | null>(null)

const editingFolder = ref<HoppCollection | null>(null)
const editingFolderPath = ref<string | null>(null)
const requestTypeToAdd = ref<"rest" | "gql">("rest")

const editingRequest = ref<HoppRESTRequest | HoppGQLRequest | null>(null)
const editingRequestName = ref("")
const editingResponseName = ref("")
const editingResponseOldName = ref("")
const editingRequestIndex = ref<number | null>(null)
const editingRequestID = ref<string | null>(null)

const editingResponseID = ref<string | null>(null)
const showAddExampleModal = ref(false)

const editingProperties = ref<EditingProperties>({
  collection: null,
  isRootCollection: false,
  path: "",
  inheritedProperties: undefined,
})

const confirmModalTitle = ref<string | null>(null)

const filterTexts = ref("")

const myCollections = useReadonlyStream(restCollections$, [], "deep")

// Dragging
const draggingToRoot = ref(false)

const collectionPropertiesModalActiveTab = ref<RESTOptionTabs>("headers")

onMounted(async () => {
  const restored = await actions.restoreOAuthCollectionProperties()
  if (restored) {
    editingProperties.value = restored.properties
    collectionPropertiesModalActiveTab.value = "authorization"
    showModalEditProperties.value = true
  }
})

const currentReorderingStatus = useReadonlyStream(currentReorderingStatus$, {
  type: "collection",
  id: "",
  parentID: "",
})

const filteredCollections = computed(() => {
  const collections = myCollections.value

  if (filterTexts.value === "") return collections

  const filterText = filterTexts.value.toLowerCase()
  const filteredCollections = []

  const isMatch = (text: string) => text.toLowerCase().includes(filterText)

  const isRequestMatch = (request: HoppRESTRequest | HoppGQLRequest) =>
    isMatch(request.name) ||
    (!isGQLRequest(request) && isMatch(request.endpoint)) ||
    (isGQLRequest(request) && isMatch(request.url))

  for (const collection of collections) {
    const filteredRequests = []
    const filteredFolders = []
    for (const request of collection.requests) {
      if (isRequestMatch(request)) filteredRequests.push(request)
    }
    for (const folder of collection.folders) {
      if (isMatch(folder.name)) filteredFolders.push(folder)
      const filteredFolderRequests = []
      for (const request of folder.requests) {
        if (isRequestMatch(request)) filteredFolderRequests.push(request)
      }
      if (filteredFolderRequests.length > 0) {
        const filteredFolder = Object.assign({}, folder)
        filteredFolder.requests = filteredFolderRequests
        filteredFolders.push(filteredFolder)
      }
    }

    if (
      filteredRequests.length + filteredFolders.length > 0 ||
      isMatch(collection.name)
    ) {
      const filteredCollection = Object.assign({}, collection)
      filteredCollection.requests = filteredRequests
      filteredCollection.folders = filteredFolders
      filteredCollections.push(filteredCollection)
    }
  }

  return filteredCollections
})

const isSelected = ({
  collectionIndex,
  folderPath,
  requestIndex,
}: {
  collectionIndex?: number | undefined
  folderPath?: string | undefined
  requestIndex?: number | undefined
}) => {
  if (collectionIndex !== undefined) {
    return (
      props.picked &&
      props.picked.pickedType === "my-collection" &&
      props.picked.collectionIndex === collectionIndex
    )
  } else if (requestIndex !== undefined && folderPath !== undefined) {
    return (
      props.picked &&
      props.picked.pickedType === "my-request" &&
      props.picked.folderPath === folderPath &&
      props.picked.requestIndex === requestIndex
    )
  } else if (folderPath !== undefined) {
    return (
      props.picked &&
      props.picked.pickedType === "my-folder" &&
      props.picked.folderPath === folderPath
    )
  }
}

const showModalAdd = ref(false)
const showModalAddRequest = ref(false)
const showModalAddFolder = ref(false)
const showModalEditRequest = ref(false)
const showModalEditResponse = ref(false)
const showModalImportExport = ref(false)
const showModalEditProperties = ref(false)
const showConfirmModal = ref(false)

const displayModalAdd = (show: boolean) => {
  showModalAdd.value = show

  if (!show) resetSelectedData()
}

const displayModalAddRequest = (show: boolean) => {
  showModalAddRequest.value = show

  if (!show) resetSelectedData()
}

const displayModalAddFolder = (show: boolean) => {
  showModalAddFolder.value = show

  if (!show) resetSelectedData()
}

const displayModalEditRequest = (show: boolean) => {
  showModalEditRequest.value = show

  if (!show) resetSelectedData()
}

const displayModalEditResponse = (show: boolean) => {
  showModalEditResponse.value = show

  if (!show) resetSelectedData()
}

const displayModalImportExport = async (
  show: boolean,
  collectionType?: string
) => {
  if (collectionType === "my-collections") {
    const isValidToken = await handleTokenValidation()
    if (!isValidToken) return
  }
  showModalImportExport.value = show

  if (!show) resetSelectedData()
}

const displayModalEditProperties = (show: boolean) => {
  showModalEditProperties.value = show

  if (!show) resetSelectedData()
}

const displayConfirmModal = (show: boolean) => {
  showConfirmModal.value = show

  if (!show) resetSelectedData()
}

const displayModalAddExample = (show: boolean) => {
  showAddExampleModal.value = show

  if (!show) resetSelectedData()
}

// ponytail: modal open/close wrappers stay thin here; all store/kernelIO side
// effects live in useCollectionActions — do not re-inline them.
const addNewRootCollection = async (name: string) => {
  if (await actions.createRootCollection(name)) displayModalAdd(false)
}

const addRequest = (payload: { path: string; folder: HoppCollection }) => {
  const { path, folder } = payload
  editingFolder.value = folder
  editingFolderPath.value = path
  requestTypeToAdd.value = "rest"
  displayModalAddRequest(true)
}

const addGqlRequest = (payload: { path: string; folder: HoppCollection }) => {
  const { path, folder } = payload
  editingFolder.value = folder
  editingFolderPath.value = path
  requestTypeToAdd.value = "gql"
  displayModalAddRequest(true)
}

const onAddRequest = async (requestName: string) => {
  const ok = await actions.createRequest({
    name: requestName,
    isGql: requestTypeToAdd.value === "gql",
    path: editingFolderPath.value,
  })
  if (ok) displayModalAddRequest(false)
}

const addFolder = (payload: { path: string; folder: HoppCollection }) => {
  const { path, folder } = payload
  editingFolder.value = folder
  editingFolderPath.value = path
  displayModalAddFolder(true)
}

const onAddFolder = async (folderName: string) => {
  const ok = await actions.createFolder(folderName, editingFolderPath.value)
  if (ok) displayModalAddFolder(false)
}

const editRequest = (payload: {
  folderPath: string | undefined
  requestIndex: string
  request: HoppRESTRequest | HoppGQLRequest
}) => {
  const { folderPath, requestIndex, request } = payload
  editingRequest.value = request
  editingRequestName.value = request.name ?? ""
  if (folderPath) {
    editingFolderPath.value = folderPath
    editingRequestIndex.value = parseInt(requestIndex)
  }
  displayModalEditRequest(true)
}

const updateEditingRequest = async (newName: string) => {
  const ok = await actions.renameRequest({
    request: editingRequest.value,
    newName,
    folderPath: editingFolderPath.value,
    requestIndex: editingRequestIndex.value,
  })
  if (ok) displayModalEditRequest(false)
}

type ResponseConfigPayload = {
  folderPath: string | undefined
  requestIndex: string
  request: HoppRESTRequest | HoppGQLRequest
  responseName: string
  responseID: string
}

const editResponse = (payload: ResponseConfigPayload) => {
  const { folderPath, requestIndex, request, responseID, responseName } =
    payload

  editingRequest.value = request
  editingRequestName.value = request.name ?? ""
  editingResponseID.value = responseID
  editingResponseName.value = responseName

  //need to store the old name for updating the response key
  editingResponseOldName.value = responseName
  if (folderPath) {
    editingFolderPath.value = folderPath
    editingRequestIndex.value = parseInt(requestIndex)
  }
  displayModalEditResponse(true)
}

const updateEditingResponse = async (newName: string) => {
  const ok = await actions.renameResponse({
    request: editingRequest.value,
    oldName: editingResponseOldName.value,
    newName,
    responseID: editingResponseID.value,
    folderPath: editingFolderPath.value,
    requestIndex: editingRequestIndex.value,
  })
  if (ok) displayModalEditResponse(false)
}

const addExample = (payload: {
  folderPath: string
  request: HoppRESTRequest | HoppGQLRequest
  requestIndex: number | string
}) => {
  const { folderPath, request, requestIndex } = payload

  // Defensive check to ensure request is valid
  if (!request || typeof request !== "object") {
    console.error("Invalid request object:", request)
    toast.error(t("error.invalid_request"))
    return
  }

  // Additional validation for required request properties — accept either the
  // REST endpoint or the GQL url as proof we have a real request.
  const hasUrl = isGQLRequest(request)
    ? !!request.url
    : !!(request as HoppRESTRequest).endpoint
  if (!request.name && !hasUrl) {
    console.error("Request missing required properties:", request)
    toast.error(t("error.invalid_request"))
    return
  }

  editingRequest.value = request
  editingRequestName.value = request.name ?? ""
  editingResponseName.value = ""
  editingResponseOldName.value = ""

  if (folderPath) {
    editingFolderPath.value = folderPath
    editingRequestIndex.value = parseInt(requestIndex.toString())
  }
  displayModalAddExample(true)
}

const onAddExample = async () => {
  await actions.addExample({
    request: editingRequest.value,
    exampleName: editingResponseName.value.trim(),
    folderPath: editingFolderPath.value,
    requestIndex: editingRequestIndex.value,
    onCloseModal: () => displayModalAddExample(false),
  })
}

// ── Remove confirm flows (UI state lives here; side effects in actions) ──

const removeCollection = (id: string) => {
  editingCollectionIndex.value = parseInt(id)

  confirmModalTitle.value = `${t("confirm.remove_collection")}`
  displayConfirmModal(true)
}

const removeFolder = (id: string) => {
  editingFolderPath.value = id

  confirmModalTitle.value = `${t("confirm.remove_folder")}`
  displayConfirmModal(true)
}

const removeRequest = (payload: {
  folderPath: string | null
  requestIndex: string
}) => {
  const { folderPath, requestIndex } = payload
  if (folderPath) {
    editingFolderPath.value = folderPath
    editingRequestIndex.value = parseInt(requestIndex)
  }
  confirmModalTitle.value = `${t("confirm.remove_request")}`
  displayConfirmModal(true)
}

const removeResponse = (payload: ResponseConfigPayload) => {
  const { folderPath, requestIndex, request, responseID, responseName } =
    payload
  if (folderPath) {
    editingFolderPath.value = folderPath
    editingRequestIndex.value = parseInt(requestIndex)
    editingResponseID.value = responseID
    editingRequest.value = request
    editingResponseName.value = responseName
  }
  confirmModalTitle.value = `${t("confirm.remove_response")}`
  displayConfirmModal(true)
}

const resolveConfirmModal = async (title: string | null) => {
  const onDeselect = () => emit("select", null)
  let done = false

  if (title === `${t("confirm.remove_collection")}`) {
    const collectionIndex = editingCollectionIndex.value
    done =
      (await actions.removeRootCollection(
        collectionIndex,
        () => isSelected({ collectionIndex: collectionIndex! }),
        onDeselect
      )) === "done"
  } else if (title === `${t("confirm.remove_request")}`) {
    const folderPath = editingFolderPath.value
    const requestIndex = editingRequestIndex.value
    done =
      (await actions.removeRequest(
        folderPath,
        requestIndex,
        () =>
          isSelected({ folderPath: folderPath!, requestIndex: requestIndex! }),
        onDeselect
      )) === "done"
  } else if (title === `${t("confirm.remove_folder")}`) {
    const folderPath = editingFolderPath.value
    done =
      (await actions.removeFolder(
        folderPath,
        () => isSelected({ folderPath: folderPath! }),
        onDeselect
      )) === "done"
  } else if (title === `${t("confirm.remove_response")}`) {
    done =
      (await actions.removeResponse({
        request: editingRequest.value,
        responseName: editingResponseName.value,
        responseID: editingResponseID.value,
        folderPath: editingFolderPath.value,
        requestIndex: editingRequestIndex.value,
      })) === "done"
  } else {
    console.error(
      `Confirm modal title ${title} is not handled by the component`
    )
    toast.error(t("error.something_went_wrong"))
    displayConfirmModal(false)
    return
  }

  if (done) displayConfirmModal(false)
}

// The request is picked in the save request as modal
const selectPicked = (payload: Picked | null) => {
  emit("select", payload)
}

// ── Drag / reorder: wire draggingToRoot UI flag into actions ──

const dropRequest = (payload: Parameters<typeof actions.dropRequest>[0]) =>
  actions.dropRequest({
    ...payload,
    onDragEnd: () => {
      draggingToRoot.value = false
    },
  })

const dropCollection = (
  payload: Parameters<typeof actions.dropCollection>[0]
) =>
  actions.dropCollection({
    ...payload,
    onDragEnd: () => {
      draggingToRoot.value = false
    },
  })

const dropToRoot = (event: DragEvent) =>
  actions.dropToRoot(event, () => {
    draggingToRoot.value = false
  })

const setCollectionProperties = (newCollection: {
  collection: Partial<HoppCollection> | null
  isRootCollection: boolean
  path: string
}) => {
  if (actions.setCollectionProperties(newCollection)) {
    displayModalEditProperties(false)
  }
}

const resetSelectedData = () => {
  editingCollection.value = null
  editingCollectionIndex.value = null
  editingCollectionID.value = null
  editingFolder.value = null
  editingFolderPath.value = null
  editingRequest.value = null
  editingRequestIndex.value = null
  editingRequestID.value = null
  confirmModalTitle.value = null
}

defineActionHandler("collection.new", () => {
  displayModalAdd(true)
})
defineActionHandler("modals.collection.import", () => {
  displayModalImportExport(true)
})
</script>
