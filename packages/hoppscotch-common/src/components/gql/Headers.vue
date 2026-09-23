<template>
  <div
    class="sticky top-sidebarPrimaryStickyFold z-10 flex items-center justify-between border-y border-dividerLight bg-primary pl-4"
  >
    <label class="font-semibold text-secondaryLight">
      {{ t("tab.headers") }}
    </label>
    <div class="flex">
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        to="https://docs.hoppscotch.io/documentation/features/graphql-api-testing"
        blank
        :title="t('app.wiki')"
        :icon="IconHelpCircle"
      />
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :title="t('action.clear_all')"
        :icon="IconTrash2"
        @click="clearContent()"
      />
      <HoppButtonSecondary
        v-if="bulkMode"
        v-tippy="{ theme: 'tooltip' }"
        :title="t('state.linewrap')"
        :class="{ '!text-accent': WRAP_LINES }"
        :icon="IconWrapText"
        @click.prevent="toggleNestedSetting('WRAP_LINES', 'graphqlHeaders')"
      />
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :title="t('state.bulk_mode')"
        :icon="IconEdit"
        :class="{ '!text-accent': bulkMode }"
        @click="bulkMode = !bulkMode"
      />
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :title="t('add.new')"
        :icon="IconPlus"
        :disabled="bulkMode"
        @click="addHeader"
      />
    </div>
  </div>
  <div v-if="bulkMode" class="h-full relative flex flex-col flex-1">
    <div ref="bulkEditor" class="absolute inset-0"></div>
  </div>
  <div v-else>
    <draggable
      v-model="workingHeaders"
      :item-key="(header: any) => `header-${header.id}`"
      animation="250"
      handle=".draggable-handle"
      draggable=".draggable-content"
      ghost-class="cursor-move"
      chosen-class="bg-primaryLight"
      drag-class="cursor-grabbing"
      :move="
        (event: DragDropEvent) =>
          isDragDropAllowed(event, workingHeaders.length)
      "
    >
      <template #item="{ element: header, index }">
        <HttpKeyValue
          v-model:name="header.key"
          v-model:value="header.value"
          v-model:description="header.description"
          :total="workingHeaders.length"
          :index="index"
          :entity-id="header.id"
          :entity-active="header.active"
          :envs="envs"
          :is-active="header.hasOwnProperty('active')"
          :inspection-key-result="getInspectorResult(headerKeyResults, index)"
          :inspection-value-result="
            getInspectorResult(headerValueResults, index)
          "
          :key-auto-complete-source="commonHeaders"
          @update-entity="updateHeader($event.index, $event.payload)"
          @delete-entity="deleteHeader($event)"
        />
      </template>
    </draggable>

    <draggable
      v-model="computedHeaders"
      item-key="id"
      animation="250"
      handle=".draggable-handle"
      draggable=".draggable-content"
      ghost-class="cursor-move"
      chosen-class="bg-primaryLight"
      drag-class="cursor-grabbing"
    >
      <template #item="{ element: header, index }">
        <div
          class="draggable-content group flex divide-x divide-dividerLight border-b border-dividerLight"
        >
          <span>
            <HoppButtonSecondary
              :icon="IconLock"
              class="cursor-auto bg-divider text-secondaryLight opacity-25"
              tabindex="-1"
            />
          </span>

          <SmartEnvInput
            v-model="header.header.key"
            :placeholder="`${t('count.value', { count: index + 1 })}`"
            :envs="envs"
            readonly
          />

          <SmartEnvInput
            :model-value="mask(header)"
            :placeholder="`${t('count.value', { count: index + 1 })}`"
            :envs="envs"
            readonly
          />

          <input
            :value="header.header.description"
            :placeholder="t('count.description')"
            class="flex flex-1 px-4 bg-transparent text-secondaryLight"
            type="text"
            readonly
          />

          <span>
            <HoppButtonSecondary
              v-if="header.source === 'auth'"
              v-tippy="{ theme: 'tooltip' }"
              :title="t(masking ? 'state.show' : 'state.hide')"
              :icon="masking ? IconEye : IconEyeOff"
              @click="toggleMask()"
            />
            <div v-else class="aspect-square w-8"></div>
          </span>

          <span>
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :icon="IconArrowUpRight"
              :title="t('request.go_to_authorization_tab')"
              @click="changeTab"
            />
          </span>
        </div>
      </template>
    </draggable>

    <draggable
      v-model="inheritedProperty"
      item-key="id"
      animation="250"
      handle=".draggable-handle"
      draggable=".draggable-content"
      ghost-class="cursor-move"
      chosen-class="bg-primaryLight"
      drag-class="cursor-grabbing"
    >
      <template #item="{ element: header, index }">
        <div
          class="draggable-content group flex divide-x divide-dividerLight border-b border-dividerLight"
        >
          <span>
            <HoppButtonSecondary
              :icon="IconLock"
              class="cursor-auto bg-divider text-secondaryLight opacity-25"
              tabindex="-1"
            />
          </span>

          <SmartEnvInput
            v-model="header.header.key"
            :placeholder="`${t('count.value', { count: index + 1 })}`"
            :envs="envs"
            readonly
          />

          <SmartEnvInput
            :model-value="
              header.source === 'auth' ? mask(header) : header.header.value
            "
            :placeholder="`${t('count.value', { count: index + 1 })}`"
            :envs="envs"
            readonly
          />
          <input
            :value="header.header.description"
            :placeholder="t('count.description')"
            class="flex flex-1 px-4 bg-transparent text-secondaryLight"
            type="text"
            readonly
          />

          <HoppButtonSecondary
            v-if="header.source === 'auth'"
            v-tippy="{ theme: 'tooltip' }"
            :title="t(masking ? 'state.show' : 'state.hide')"
            :icon="masking && header.source === 'auth' ? IconEye : IconEyeOff"
            @click="toggleMask()"
          />
          <span v-else class="aspect-square w-[2.05rem]"></span>
          <span>
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :icon="IconInfo"
              :title="`This header is inherited from Parent Collection ${
                header.inheritedFrom ?? ''
              }`"
            />
          </span>
        </div>
      </template>
    </draggable>

    <HoppSmartPlaceholder
      v-if="workingHeaders.length === 0"
      :src="`/images/states/${colorMode.value}/add_category.svg`"
      :alt="`${t('empty.headers')}`"
      :text="t('empty.headers')"
    >
      <template #body>
        <HoppButtonSecondary
          :label="`${t('add.new')}`"
          filled
          :icon="IconPlus"
          @click="addHeader"
        />
      </template>
    </HoppSmartPlaceholder>
  </div>
</template>

<script setup lang="ts">
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useColorMode } from "@composables/theming"
import { useReadonlyStream } from "@composables/stream"
import {
  Environment,
  GQLHeader,
  HoppGQLAuth,
  HoppGQLRequest,
} from "@hoppscotch/data"
import { useVModel } from "@vueuse/core"
import { computed, reactive, Ref, ref, watch } from "vue"
import draggable from "vuedraggable-es"

import { commonHeaders } from "~/helpers/headers"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { isDragDropAllowed, DragDropEvent } from "~/helpers/dragDropValidation"
import { getComputedGQLAuthHeaders } from "~/helpers/utils/EffectiveURL"
import {
  filterNonEmptyEnvironmentVariables,
  getEffectiveVariablesForRequest,
} from "~/helpers/utils/environments"
import {
  AggregateEnvironment,
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue,
} from "~/newstore/environments"
import { toggleNestedSetting } from "~/newstore/settings"
import IconArrowUpRight from "~icons/lucide/arrow-up-right"
import IconEdit from "~icons/lucide/edit"
import IconEye from "~icons/lucide/eye"
import IconEyeOff from "~icons/lucide/eye-off"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconInfo from "~icons/lucide/info"
import IconLock from "~icons/lucide/lock"
import IconPlus from "~icons/lucide/plus"
import IconTrash2 from "~icons/lucide/trash-2"
import IconWrapText from "~icons/lucide/wrap-text"
import type { GQLOptionTabs } from "~/helpers/requestOptions"
import { useKeyValueTable, KeyValueRow } from "~/composables/useKeyValueTable"

const colorMode = useColorMode()
const t = useI18n()

type GqlHeadersModel =
  HoppGQLRequest | { headers: GQLHeader[]; auth: HoppGQLAuth }

const props = defineProps<{
  modelValue: GqlHeadersModel
  inheritedProperties?: HoppInheritedProperty
  // Embed-only env scope; omit to use the global aggregate envs
  envs?: AggregateEnvironment[]
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: GqlHeadersModel): void
  (e: "change-tab", value: GQLOptionTabs): void
}>()

const request = useVModel(props, "modelValue", emit)

const {
  bulkMode,
  bulkHeaders,
  bulkEditor,
  WRAP_LINES,
  workingHeaders,
  addHeader,
  updateHeader,
  deleteHeader,
  clearContent,
  headerKeyResults,
  headerValueResults,
  getInspectorResult,
  masking,
  toggleMask,
  mask,
} = useKeyValueTable(request as Ref<{ headers: (GQLHeader & KeyValueRow)[] }>, {
  wrapSetting: "graphqlHeaders",
})

useCodemirror(
  bulkEditor,
  bulkHeaders,
  reactive({
    extendedEditorConfig: {
      mode: "text/x-yaml",
      placeholder: `${t("state.bulk_mode_placeholder")}`,
      lineWrapping: WRAP_LINES,
    },
    linter: null,
    completer: null,
    environmentHighlights: true,
    envs: computed(() => props.envs),
    predefinedVariablesHighlights: true,
  })
)

const aggregateEnvs = useReadonlyStream(
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue()
)

// Same precedence as the send path (gql-tab-connection.service): inherited
// collection variables outrank selected/global env vars. A scoped `envs`
// prop (embeds) replaces the global aggregate, mirroring http/Headers.
const resolvedEnvs = computed<Environment["variables"]>(() =>
  filterNonEmptyEnvironmentVariables(
    getEffectiveVariablesForRequest(
      undefined,
      props.inheritedProperties?.variables,
      props.envs ?? aggregateEnvs.value
    )
  )
)

const computedHeaders: Ref<
  {
    source: "auth"
    header: GQLHeader
    id: string
  }[]
> = ref([])

watch(
  [request, resolvedEnvs],
  async (_newVals, _oldVals, onCleanup) => {
    let isStale = false
    onCleanup(() => {
      isStale = true
    })

    const headers = await getComputedGQLAuthHeaders(
      resolvedEnvs.value,
      request.value
    )
    if (isStale) return

    computedHeaders.value = headers.map((header, index) => ({
      id: `header-${index}`,
      source: "auth",
      header,
    }))
  },
  { immediate: true, deep: true }
)

type InheritedHeader = {
  inheritedFrom: string
  source: "auth" | "headers"
  id: string
  header: GQLHeader
}

const inheritedProperty = ref<InheritedHeader[]>([])

watch(
  [() => props.inheritedProperties, request, resolvedEnvs],
  async (_newVals, _oldVals, onCleanup) => {
    let isStale = false
    onCleanup(() => {
      isStale = true
    })

    if (!props.inheritedProperties) {
      // Clear any previously-computed inherited rows so they don't linger when
      // the request switches to one without inherited collection settings.
      inheritedProperty.value = []
      return
    }

    const inheritedHeaders = props.inheritedProperties.headers.filter(
      (header) =>
        !request.value.headers.some(
          (requestHeader) =>
            requestHeader.key === header.inheritedHeader?.key &&
            requestHeader.active
        )
    )
    const headersList: InheritedHeader[] = inheritedHeaders.map(
      (header, index) => ({
        inheritedFrom: header.parentName!,
        source: "headers",
        id: `header-${index}`,
        header: header.inheritedHeader,
      })
    )

    if (
      props.inheritedProperties.auth &&
      request.value.auth.authType === "inherit" &&
      request.value.auth.authActive &&
      !request.value.headers.some(
        (requestHeader) =>
          requestHeader.key === "Authorization" && requestHeader.active
      )
    ) {
      try {
        const [computedAuthHeader] = await getComputedGQLAuthHeaders(
          resolvedEnvs.value,
          request.value,
          props.inheritedProperties.auth.inheritedAuth
        )
        if (isStale) return

        if (computedAuthHeader) {
          headersList.push({
            inheritedFrom: props.inheritedProperties.auth.parentName,
            source: "auth",
            id: `header-auth`,
            header: computedAuthHeader,
          })
        }
      } catch (e) {
        // A signing generator can throw (eg. aws-signature on an unresolvable
        // URL) — commit the headers collected so far without the auth row
        // rather than erasing every inherited header.
        if (isStale) return
        console.error(e)
      }
    }

    inheritedProperty.value = headersList
  },
  { immediate: true, deep: true }
)

const changeTab = () => emit("change-tab", "authorization")
</script>
