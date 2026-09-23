<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky top-upperMobileSecondaryStickyFold z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4 sm:top-upperSecondaryStickyFold"
    >
      <label class="truncate font-semibold text-secondaryLight">
        {{ t("preRequest.javascript_code") }}
      </label>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/pre-request-scripts"
          blank
          :title="t('app.wiki')"
          :icon="IconHelpCircle"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear')"
          :icon="IconTrash2"
          @click="clearContent"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('state.linewrap')"
          :class="{ '!text-accent': WRAP_LINES }"
          :icon="IconWrapText"
          @click.prevent="toggleNestedSetting('WRAP_LINES', 'httpPreRequest')"
        />
        <HoppButtonSecondary
          v-if="shouldEnableAIFeatures && currentRequest"
          v-tippy="{ theme: 'tooltip' }"
          :title="t('ai_experiments.modify_with_ai')"
          :icon="IconSparkles"
          @click="showModifyPreRequestModal"
        />
      </div>
    </div>
    <div class="flex flex-1 border-b border-dividerLight">
      <div class="flex h-full w-2/3 flex-col border-r border-dividerLight">
        <div
          v-if="inheritedScripts.length > 0"
          class="frosted-pane m-2 flex max-h-[50%] flex-col border-l-2 border-l-yellow-500"
        >
          <div
            class="flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-dividerDark px-3 py-1.5"
          >
            <icon-lucide-file-symlink
              class="svg-icons flex-shrink-0 !h-3.5 !w-3.5 text-yellow-500"
              aria-hidden="true"
            />
            <span class="truncate text-tiny text-secondaryLight">
              {{ t("script.inheriting") }}
              <span class="font-semibold text-secondaryDark">
                {{ inheritedParentNames }}
              </span>
            </span>
            <span
              class="ml-auto flex flex-shrink-0 items-center gap-1 text-tiny text-secondaryLight"
            >
              <icon-lucide-lock
                class="svg-icons !h-3 !w-3"
                aria-hidden="true"
              />
              {{ t("script.read_only") }}
            </span>
          </div>
          <div ref="inheritedEditor" class="min-h-0 overflow-auto"></div>
        </div>
        <div class="relative min-h-0 flex-1">
          <MonacoScriptEditor
            v-if="EXPERIMENTAL_SCRIPTING_SANDBOX && props.isActive"
            v-model="preRequestScript"
            :is-active="props.isActive"
            type="pre-request"
          />

          <div
            v-else
            ref="preRequestEditor"
            class="h-full absolute inset-0"
          ></div>
        </div>
      </div>
      <div
        class="z-[9] sticky top-upperTertiaryStickyFold h-full min-w-[12rem] max-w-1/3 flex-shrink-0 overflow-auto overflow-x-auto bg-primary p-4"
      >
        <div class="pb-2 text-secondaryLight">
          {{ t("helpers.pre_request_script") }}
        </div>
        <HoppSmartAnchor
          :label="`${t('preRequest.learn')}`"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/pre-request-scripts"
          blank
        />
        <h4 class="pt-6 font-bold text-secondaryLight">
          {{ t("preRequest.snippets") }}
        </h4>
        <div class="flex flex-col pt-4">
          <TabSecondary
            v-for="(snippet, index) in snippets"
            :key="`snippet-${index}`"
            :label="snippet.name"
            active
            @click="useSnippet(snippet.script)"
          />
        </div>
      </div>
    </div>
    <AiexperimentsModifyPreRequestModal
      v-if="isModifyPreRequestModalOpen && currentRequest"
      :current-script="preRequestScript"
      :request-info="currentRequest"
      @close-modal="isModifyPreRequestModalOpen = false"
      @update-script="(updatedScript) => (preRequestScript = updatedScript)"
    />
  </div>
</template>

<script setup lang="ts">
import AiexperimentsModifyPreRequestModal from "@components/aiexperiments/ModifyPreRequestModal.vue"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import snippets from "@helpers/preRequestScriptSnippets"
import { useVModel } from "@vueuse/core"
import { useService } from "dioc/vue"
import { computed, reactive, ref } from "vue"

import { useAIExperiments } from "~/composables/ai-experiments"
import { useNestedSetting, useSetting } from "~/composables/settings"
import completer from "~/helpers/editor/completion/preRequest"
import linter from "~/helpers/editor/linting/preRequest"
import {
  hasActualScript,
  stripModulePrefix,
} from "@hoppscotch/js-sandbox/scripting"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { toggleNestedSetting } from "~/newstore/settings"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconSparkles from "~icons/lucide/sparkles"
import IconTrash2 from "~icons/lucide/trash-2"
import IconWrapText from "~icons/lucide/wrap-text"

const t = useI18n()

const props = defineProps<{
  modelValue: string
  isActive?: boolean
  inheritedProperties?: HoppInheritedProperty
}>()
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
}>()

const preRequestScript = useVModel(props, "modelValue", emit)

const inheritedScripts = computed(() => {
  return (
    props.inheritedProperties?.scripts?.filter((script) =>
      hasActualScript(script.preRequestScript)
    ) ?? []
  )
})

// Inherited scripts are shown read-only above the request's own script, in the
// order they run (root → child). Each block is tagged with its collection name
// when more than one collection contributes.
const inheritedScript = computed(() =>
  inheritedScripts.value
    .map((script) => {
      const body = stripModulePrefix(script.preRequestScript).trim()

      return inheritedScripts.value.length > 1
        ? `// ${script.parentName}\n${body}`
        : body
    })
    .join("\n\n")
)

const inheritedParentNames = computed(() =>
  inheritedScripts.value.map((script) => script.parentName).join(" · ")
)

const preRequestEditor = ref<any | null>(null)
const WRAP_LINES = useNestedSetting("WRAP_LINES", "httpPreRequest")

useCodemirror(
  preRequestEditor,
  preRequestScript,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      lineWrapping: WRAP_LINES,
      placeholder: `${t("preRequest.javascript_code")}`,
    },
    linter,
    completer,
    environmentHighlights: false,
    contextMenuEnabled: false,
  })
)

const EXPERIMENTAL_SCRIPTING_SANDBOX = useSetting(
  "EXPERIMENTAL_SCRIPTING_SANDBOX"
)

const inheritedEditor = ref<any | null>(null)

useCodemirror(
  inheritedEditor,
  inheritedScript,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      readOnly: true,
      lineWrapping: WRAP_LINES,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

const useSnippet = (script: string) => {
  preRequestScript.value += script
}

const clearContent = () => {
  preRequestScript.value = ""
}
const tabService = useService(WorkspaceTabsService)

const currentRequest = computed(() =>
  tabService.currentActiveTab.value?.document.type === "request"
    ? tabService.currentActiveTab.value?.document.request
    : null
)

const { shouldEnableAIFeatures } = useAIExperiments()
const isModifyPreRequestModalOpen = ref(false)

const showModifyPreRequestModal = () => {
  isModifyPreRequestModalOpen.value = true
}
</script>

<style lang="scss" scoped>
:deep(.cm-panels) {
  @apply top-upperTertiaryStickyFold #{!important};
}
</style>
