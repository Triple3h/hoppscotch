<template>
  <div>
    <AppPaneLayout layout-id="http">
      <template #primary>
        <!-- Fixed left rail: always-visible entry to every open tab (request,
             folder, environment, test-runner, …). Geometry mirrors the right
             env selector (h-12 rail, h-9 trigger) so popover spacing matches.
             `flex-1 min-h-0` is load-bearing: without it this block sizes to
             its content, so the tab body (and the request/response split
             inside it) never fills the pane and the pane heights resolve
             against a content-sized box. -->
        <div
          class="relative flex min-h-0 flex-1 flex-col [&_.tabs>div:first-child]:pl-10"
        >
          <div
            class="absolute left-0 top-0 z-20 flex h-12 items-center border-r border-dividerLight bg-primaryLight px-1"
          >
            <WorkspaceAllTabsMenu
              :entries="tabMenuEntries"
              :active-id="currentTabID"
              :removable="activeTabs.length > 1"
              @select="setActiveTab"
              @close="removeTab"
            />
          </div>
          <HoppSmartWindows
            v-if="currentTabID"
            :id="'rest_windows'"
            v-model="currentTabID"
            @remove-tab="removeTab"
            @add-tab="addNewTab"
            @sort="sortTabs"
          >
            <HoppSmartWindow
              v-for="tab in activeTabs"
              :id="tab.id"
              :key="tab.id"
              :label="getTabName(tab)"
              :is-removable="activeTabs.length > 1"
              :close-visibility="'hover'"
            >
              <template #tabhead>
                <HttpTabHead
                  v-if="
                    tab.document.type === 'request' ||
                    tab.document.type === 'example-response'
                  "
                  :tab="tab"
                  :is-removable="activeTabs.length > 1"
                  @open-rename-modal="openReqRenameModal(tab.id)"
                  @close-tab="removeTab(tab.id)"
                  @close-other-tabs="closeOtherTabsAction(tab.id)"
                  @duplicate-tab="duplicateTab(tab.id)"
                />
                <GqlTabHead
                  v-else-if="
                    tab.document.type === 'gql-request' ||
                    tab.document.type === 'gql-example-response'
                  "
                  :tab="tab"
                  :is-removable="activeTabs.length > 1"
                  @open-rename-modal="openReqRenameModal(tab.id)"
                  @close-tab="removeTab(tab.id)"
                  @close-other-tabs="closeOtherTabsAction(tab.id)"
                  @duplicate-tab="duplicateTab(tab.id)"
                />
                <!-- Fallback for document types without a dedicated head
                   (test-runner, collection, environment) — providing the
                   #tabhead slot suppresses the Window's own `label`, so an
                   unmatched type would otherwise render a blank tab head. -->
                <span v-else class="flex items-center gap-1 truncate px-2">
                  <icon-lucide-folder
                    v-if="tab.document.type === 'collection'"
                    class="svg-icons flex-shrink-0"
                    aria-hidden="true"
                  />
                  <icon-lucide-layers
                    v-else-if="tab.document.type === 'environment'"
                    class="svg-icons flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ getTabName(tab) }}</span>
                </span>
              </template>
              <template #suffix>
                <span
                  v-if="tab.document.isDirty"
                  class="flex w-4 items-center justify-center text-secondary group-hover:hidden"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="1.2em"
                    height="1.2em"
                    class="h-1.5 w-1.5"
                  >
                    <circle cx="12" cy="12" r="12" fill="currentColor"></circle>
                  </svg>
                </span>
              </template>
              <!-- Always show the shared top bar (REST badge + path + save) -->
              <HttpProtocolSwitcher
                v-if="
                  tab.document.type === 'request' ||
                  tab.document.type === 'gql-request'
                "
              />
              <HttpExampleResponseTab
                v-if="
                  tab.document.type === 'example-response' &&
                  tab.document.response
                "
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <GqlExampleResponseTab
                v-if="
                  tab.document.type === 'gql-example-response' &&
                  tab.document.response
                "
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- Render TabContents -->
              <HttpTestRunner
                v-if="tab.document.type === 'test-runner'"
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- When document.type === 'request' the tab type is HoppTab<HoppRequestDocument>-->
              <HttpRequestTab
                v-if="tab.document.type === 'request'"
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- Collection/folder properties tab -->
              <CollectionsCollectionTab
                v-if="tab.document.type === 'collection'"
                :model-value="tab"
              />
              <!-- Environment editor tab -->
              <EnvironmentsEnvironmentTab
                v-if="tab.document.type === 'environment'"
                :model-value="tab"
              />
              <!-- When document.type === 'gql-request' render GQL tab -->
              <GqlRequestTab
                v-if="tab.document.type === 'gql-request'"
                :model-value="tab"
                @update:model-value="onTabUpdate"
              />
              <!-- END Render TabContents -->
            </HoppSmartWindow>
            <template #actions>
              <div class="flex h-12 w-max items-center">
                <EnvironmentsSelector />
              </div>
            </template>
          </HoppSmartWindows>
        </div>
      </template>
      <template #sidebar>
        <HttpSidebar />
      </template>
    </AppPaneLayout>
    <CollectionsEditRequest
      v-model="reqName"
      :request-context="requestToRename"
      :show="showRenamingReqNameModal"
      @submit="renameReqName"
      @hide-modal="showRenamingReqNameModal = false"
    />
    <HoppSmartConfirmModal
      :show="confirmingCloseAllTabs"
      :confirm="t('modal.close_unsaved_tab')"
      :title="t('confirm.close_unsaved_tabs', { count: unsavedTabsCount })"
      @hide-modal="confirmingCloseAllTabs = false"
      @resolve="onResolveConfirmCloseAllTabs"
    />
    <HoppSmartModal
      v-if="confirmingCloseForTabID !== null"
      dialog
      role="dialog"
      aria-modal="true"
      :title="t('modal.close_unsaved_tab')"
      @close="confirmingCloseForTabID = null"
    >
      <template #body>
        <div class="text-center">
          {{ t("confirm.save_unsaved_tab") }}
        </div>
      </template>
      <template #footer>
        <span class="flex space-x-2">
          <HoppButtonPrimary
            v-focus
            :label="t?.('action.yes')"
            outline
            @click="onResolveConfirmSaveTab"
          />
          <HoppButtonSecondary
            :label="t?.('action.no')"
            filled
            outline
            @click="onCloseConfirmSaveTab"
          />
        </span>
      </template>
    </HoppSmartModal>
    <CollectionsSaveRequest
      v-if="savingRequest"
      :mode="saveRequestMode"
      :show="savingRequest"
      @hide-modal="onSaveModalClose"
    />
    <AppContextMenu
      v-if="contextMenu.show"
      :show="contextMenu.show"
      :position="contextMenu.position"
      :text="contextMenu.text"
      @hide-modal="contextMenu.show = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount } from "vue"
import { safelyExtractRESTRequest } from "@hoppscotch/data"
import { translateExtURLParams } from "~/helpers/RESTExtURLParams"
import { useRoute } from "vue-router"
import { useI18n } from "@composables/i18n"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { defineActionHandler } from "~/helpers/actions"
import { platform } from "~/platform"
import { useService } from "dioc/vue"
import { RequestInspectorService } from "~/services/inspection/inspectors/request.inspector"
import { EnvironmentInspectorService } from "~/services/inspection/inspectors/environment.inspector"
import { ResponseInspectorService } from "~/services/inspection/inspectors/response.inspector"
import { ScriptingInterceptorInspectorService } from "~/services/inspection/inspectors/scripting-interceptor.inspector"
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service"
import { useTabBar } from "@composables/useTabBar"
// Explicit import: unplugin-vue-components did not rewrite this tag to a
// static import on a running dev server, so runtime _resolveComponent left
// the environment tab body blank.
import EnvironmentsEnvironmentTab from "~/components/environments/EnvironmentTab.vue"
import WorkspaceAllTabsMenu from "~/components/workspace/AllTabsMenu.vue"

const gqlTabConn = useService(GQLTabConnectionService)

// Tear down every GQL tab's poll timer and subscription socket when the user
// navigates away from the REST workspace. Per-tab cleanup on close covers
// tab-by-tab removal, but nothing fires when the whole page unmounts — so
// without this each gql-request tab's 7s schema poll keeps running for the
// rest of the app session. `disconnectAllTabs` clears the per-tab contexts;
// each tab re-establishes a fresh connection when the page is revisited.
onBeforeUnmount(() => {
  gqlTabConn.disconnectAllTabs()
})

const t = useI18n()

const {
  currentTabID,
  activeTabs,
  getTabName,
  tabMenuEntries,
  requestToRename,
  reqName,
  showRenamingReqNameModal,
  openReqRenameModal,
  renameReqName,
  confirmingCloseForTabID,
  confirmingCloseAllTabs,
  unsavedTabsCount,
  savingRequest,
  saveRequestMode,
  setActiveTab,
  addNewTab,
  sortTabs,
  removeTab,
  closeOtherTabsAction,
  duplicateTab,
  onTabUpdate,
  onCloseConfirmSaveTab,
  onResolveConfirmSaveTab,
  onSaveModalClose,
  onResolveConfirmCloseAllTabs,
  openDocument,
  patchActiveRestRequest,
  goToNextTab,
  goToPreviousTab,
  goToFirstTab,
  goToLastTab,
  reopenClosedTab,
  goToMRUTab,
  goToPreviousMRUTab,
} = useTabBar()

type PopupDetails = {
  show: boolean
  position: {
    top: number
    left: number
  }
  text: string | null
}

const contextMenu = ref<PopupDetails>({
  show: false,
  position: {
    top: 0,
    left: 0,
  },
  text: null,
})

function bindRequestToURLParams() {
  const route = useRoute()
  // Get URL parameters and set that as the request
  onMounted(() => {
    const query = route.query
    // If query params are empty, or contains code or error param (these are from Oauth Redirect)
    // We skip URL params parsing
    if (Object.keys(query).length === 0 || query.code || query.error) return

    patchActiveRestRequest((request) =>
      safelyExtractRESTRequest(
        translateExtURLParams(query, request),
        getDefaultRESTRequest()
      )
    )
  })
}

defineActionHandler("contextmenu.open", ({ position, text }) => {
  if (text) {
    contextMenu.value = {
      show: true,
      position,
      text,
    }
  } else {
    contextMenu.value = {
      show: false,
      position,
      text,
    }
  }
})

bindRequestToURLParams()

defineActionHandler("rest.request.open", ({ doc }) => {
  openDocument(doc)
})

defineActionHandler("rest.gql-request.open", ({ doc }) => {
  openDocument(doc)
})

defineActionHandler("request.rename", () => {
  openReqRenameModal()
})

defineActionHandler("tab.duplicate-tab", ({ tabID }) => {
  duplicateTab(tabID ?? currentTabID.value)
})

defineActionHandler("tab.close-current", () => {
  removeTab(currentTabID.value)
})

defineActionHandler("tab.close-other", () => {
  // Route through closeOtherTabsAction so the keyboard shortcut gets the same
  // dirty-tab confirmation (and scroll/GQL cleanup) as the tab context menu,
  // instead of force-closing unsaved tabs.
  closeOtherTabsAction(currentTabID.value)
})

defineActionHandler("tab.open-new", addNewTab)

defineActionHandler("tab.next", goToNextTab)

defineActionHandler("tab.prev", goToPreviousTab)

defineActionHandler("tab.switch-to-first", goToFirstTab)

defineActionHandler("tab.switch-to-last", goToLastTab)

defineActionHandler("tab.reopen-closed", reopenClosedTab)

defineActionHandler("tab.mru-switch", goToMRUTab)

defineActionHandler("tab.mru-switch-reverse", goToPreviousMRUTab)

useService(RequestInspectorService)
useService(EnvironmentInspectorService)
useService(ResponseInspectorService)
useService(ScriptingInterceptorInspectorService)

for (const inspectorDef of platform.additionalInspectors ?? []) {
  useService(inspectorDef.service)
}
</script>
