<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4"
      :class="[
        isCollectionProperty
          ? 'top-propertiesPrimaryStickyFold'
          : 'top-upperMobileSecondaryStickyFold sm:top-upperSecondaryStickyFold',
      ]"
    >
      <label class="truncate font-semibold text-secondaryLight">
        {{ t("request.header_list") }}
      </label>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/features/rest-api-testing"
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
          @click.prevent="toggleNestedSetting('WRAP_LINES', 'httpHeaders')"
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

    <div v-if="bulkMode" class="h-full relative w-full flex flex-col flex-1">
      <div
        ref="bulkEditor"
        :class="{
          'absolute inset-0': !isCollectionProperty,
        }"
      ></div>
    </div>
    <div v-else>
      <draggable
        v-model="workingHeaders"
        :item-key="(header: WorkingHeader) => `header-${header.id}`"
        animation="250"
        handle=".draggable-handle"
        draggable=".draggable-content"
        ghost-class="cursor-move"
        chosen-class="bg-primaryLight"
        drag-class="cursor-grabbing"
        :move="
          (event: DragDropEvent): boolean =>
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
              readonly
            />

            <SmartEnvInput
              :model-value="mask(header)"
              :placeholder="`${t('count.value', { count: index + 1 })}`"
              readonly
            />

            <input
              :value="header.header.description"
              :placeholder="t('count.description')"
              type="text"
              readonly
              class="flex flex-1 px-4 bg-transparent text-secondaryLight"
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
                :title="changeTabTooltip(header.source)"
                @click="changeTab(header.source)"
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
              readonly
            />

            <SmartEnvInput
              :model-value="
                header.source === 'auth' ? mask(header) : header.header.value
              "
              :placeholder="`${t('count.value', { count: index + 1 })}`"
              readonly
            />

            <input
              :value="header.header.description"
              :placeholder="t('count.description')"
              type="text"
              readonly
              class="flex flex-1 px-4 bg-transparent text-secondaryLight"
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
            filled
            :label="`${t('add.new')}`"
            :icon="IconPlus"
            @click="addHeader"
          />
        </template>
      </HoppSmartPlaceholder>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { useColorMode } from "@composables/theming"
import { HoppRESTAuth, HoppRESTHeader, HoppRESTRequest } from "@hoppscotch/data"
import { computed, reactive, Ref, ref, watch } from "vue"
import draggable from "vuedraggable-es"

import { useVModel } from "@vueuse/core"
import linter from "~/helpers/editor/linting/rawKeyValue"
import { commonHeaders } from "~/helpers/headers"
import {
  ComputedHeader,
  getComputedAuthHeaders,
  getComputedHeaders,
} from "~/helpers/utils/EffectiveURL"
import { isDragDropAllowed, DragDropEvent } from "~/helpers/dragDropValidation"
import {
  filterNonEmptyEnvironmentVariables,
  normalizeAggregateEnvs,
} from "~/helpers/utils/environments"
import {
  AggregateEnvironment,
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue,
  getCurrentEnvironment,
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
import { RESTOptionTabs } from "./RequestOptions.vue"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { useService } from "dioc/vue"
import { useKeyValueTable, KeyValueRow } from "~/composables/useKeyValueTable"

const t = useI18n()

const colorMode = useColorMode()

const currentEnvironmentValueService = useService(CurrentValueService)

// v-model integration with props and emit
const props = defineProps<{
  modelValue:
    | HoppRESTRequest
    | {
        headers: HoppRESTHeader[]
        auth: HoppRESTAuth
      }
  isCollectionProperty?: boolean
  inheritedProperties?: HoppInheritedProperty
  envs?: AggregateEnvironment[]
  // Embed-only codemirror scope — `envs` alone must keep workspace editors live
  scopedEnvs?: AggregateEnvironment[]
}>()

const emit = defineEmits<{
  (e: "change-tab", value: RESTOptionTabs): void
  (e: "update:modelValue", value: HoppRESTRequest): void
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
} = useKeyValueTable(
  request as Ref<{ headers: (HoppRESTHeader & KeyValueRow)[] }>,
  { wrapSetting: "httpHeaders" }
)

type WorkingHeader = HoppRESTHeader & { id: number }

useCodemirror(
  bulkEditor,
  bulkHeaders,
  reactive({
    extendedEditorConfig: {
      mode: "text/x-yaml",
      placeholder: `${t("state.bulk_mode_placeholder")}`,
      lineWrapping: WRAP_LINES,
    },
    linter,
    completer: null,
    environmentHighlights: true,
    envs: computed(() => props.scopedEnvs),
    predefinedVariablesHighlights: true,
  })
)

const aggregateEnvs = useReadonlyStream(
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue()
)

const computedHeaders: Ref<
  {
    source: "auth" | "body"
    header: HoppRESTHeader
    id: string
  }[]
> = ref([])

const inheritedProperty = ref<
  {
    inheritedFrom: string
    source: "auth" | "headers"
    id: string
    header: HoppRESTHeader
  }[]
>([])

const resolvedEnvs = computed(() => {
  // Normalize to the v2 env shape so any legacy `{ key, value }` rows still
  // resolve correctly in the computed headers/auth below.
  if (props.envs) return normalizeAggregateEnvs(props.envs)
  const currentSelectedEnvironment = getCurrentEnvironment()
  return aggregateEnvs.value.map((env) => {
    return {
      ...env,
      currentValue:
        env.currentValue !== ""
          ? env.currentValue
          : (currentEnvironmentValueService.getEnvironmentByKey(
              env?.sourceEnv !== "Global"
                ? currentSelectedEnvironment.id
                : "Global",
              env?.key ?? ""
            )?.currentValue ?? ""),
    }
  })
})

watch(
  [() => props.modelValue, resolvedEnvs],
  async (_newVals, _oldVals, onCleanup) => {
    let isStale = false
    onCleanup(() => {
      isStale = true
    })

    const headers = await getComputedHeaders(
      props.modelValue,
      filterNonEmptyEnvironmentVariables(resolvedEnvs.value)
    )
    if (isStale) return

    computedHeaders.value = headers.map((header, index) => ({
      id: `header-${index}`,
      ...header,
    }))
  },
  { immediate: true, deep: true }
)

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
    const headersList = inheritedHeaders.map((header, index) => ({
      inheritedFrom: header.parentName,
      source: "headers" as const,
      id: `header-${index}`,
      header: header.inheritedHeader,
    }))

    if (
      props.inheritedProperties.auth &&
      request.value.auth.authType === "inherit" &&
      request.value.auth.authActive &&
      !request.value.headers.some(
        (requestHeader) =>
          requestHeader.key === "Authorization" && requestHeader.active
      )
    ) {
      const [computedAuthHeader] = await getComputedAuthHeaders(
        filterNonEmptyEnvironmentVariables(resolvedEnvs.value),
        request.value,
        props.inheritedProperties.auth.inheritedAuth,
        false
      )
      if (isStale) return

      if (computedAuthHeader) {
        headersList.push({
          inheritedFrom: props.inheritedProperties.auth.parentName,
          source: "auth" as const,
          id: `header-auth`,
          header: computedAuthHeader,
        })
      }
    }

    inheritedProperty.value = headersList
  },
  { immediate: true, deep: true }
)

const changeTabTooltip = (tab: ComputedHeader["source"]) => {
  switch (tab) {
    case "auth":
      return t("request.go_to_authorization_tab")
    case "body":
      return t("request.go_to_body_tab")
  }
}

const changeTab = (tab: ComputedHeader["source"]) => {
  if (tab === "auth") emit("change-tab", "authorization")
  else emit("change-tab", "bodyParams")
}
</script>

<style lang="scss" scoped>
:deep(.cm-panels) {
  @apply top-upperTertiaryStickyFold #{!important};
}
</style>
