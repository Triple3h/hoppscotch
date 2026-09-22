<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky top-upperMobileSecondaryStickyFold z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4 sm:top-upperSecondaryStickyFold"
    >
      <label class="truncate font-semibold text-secondaryLight">
        {{ t("test.javascript_code") }}
      </label>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/tests"
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
          @click.prevent="toggleNestedSetting('WRAP_LINES', 'httpTest')"
        />
        <HoppButtonSecondary
          v-if="shouldEnableAIFeatures && currentRequest"
          v-tippy="{ theme: 'tooltip' }"
          :title="t('ai_experiments.modify_with_ai')"
          :icon="IconSparkles"
          @click="showModifyTestScriptModal"
        />
      </div>
    </div>
    <div class="flex flex-1 border-b border-dividerLight">
      <div class="flex h-full w-2/3 flex-col border-r border-dividerLight">
        <div
          v-if="inheritedScripts.length > 0"
          class="frosted-pane m-2 flex min-h-0 flex-1 flex-col"
        >
          <div
            class="flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-dividerLight px-3 py-1.5"
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
          <div ref="inheritedEditor" class="min-h-0 flex-1 overflow-auto"></div>
        </div>
        <div class="relative min-h-0 flex-1">
          <MonacoScriptEditor
            v-if="EXPERIMENTAL_SCRIPTING_SANDBOX && props.isActive"
            v-model="testScript"
            :is-active="props.isActive"
            type="post-request"
          />

          <div
            v-else
            ref="testScriptEditor"
            class="h-full absolute inset-0"
          ></div>
        </div>
      </div>
      <div
        class="z-[9] sticky top-upperTertiaryStickyFold h-full min-w-[12rem] max-w-1/3 flex-shrink-0 overflow-auto overflow-x-auto bg-primary p-4"
      >
        <div class="pb-2 text-secondaryLight">
          {{ t("helpers.post_request_tests") }}
        </div>
        <HoppSmartAnchor
          :label="`${t('test.learn')}`"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/tests"
          blank
        />
        <h4 class="pt-6 font-bold text-secondaryLight">
          {{ t("test.snippets") }}
        </h4>
        <div class="flex flex-col pt-4">
          <TabSecondary
            v-for="(snippet, index) in testSnippets"
            :key="`snippet-${index}`"
            :label="snippet.name"
            active
            @click="useSnippet(snippet.script)"
          />
        </div>
      </div>
    </div>
    <AiexperimentsModifyTestScriptModal
      v-if="isModifyTestScriptModalOpen && currentRequest"
      :current-script="testScript"
      :request-info="currentRequest"
      @close-modal="isModifyTestScriptModalOpen = false"
      @update-script="(updatedScript) => (testScript = updatedScript)"
    />
  </div>
</template>

<script setup lang="ts">
import AiexperimentsModifyTestScriptModal from "@components/aiexperiments/ModifyTestScriptModal.vue"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useVModel } from "@vueuse/core"
import { useService } from "dioc/vue"
import { computed, reactive, ref } from "vue"
import { useAIExperiments } from "~/composables/ai-experiments"
import { useNestedSetting, useSetting } from "~/composables/settings"
import completer from "~/helpers/editor/completion/testScript"
import linter from "~/helpers/editor/linting/testScript"
import {
  hasActualScript,
  stripModulePrefix,
} from "@hoppscotch/js-sandbox/scripting"
import testSnippets from "~/helpers/testSnippets"
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

const emit = defineEmits(["update:modelValue"])
const testScript = useVModel(props, "modelValue", emit)

const inheritedScripts = computed(() => {
  return (
    props.inheritedProperties?.scripts?.filter((script) =>
      hasActualScript(script.testScript)
    ) ?? []
  )
})

// Inherited scripts are shown read-only above the request's own script, in
// collection hierarchy order (root → child). Each block is tagged with its
// collection name when more than one collection contributes.
const inheritedScript = computed(() =>
  inheritedScripts.value
    .map((script) => {
      const body = stripModulePrefix(script.testScript).trim()

      return inheritedScripts.value.length > 1
        ? `// ${script.parentName}\n${body}`
        : body
    })
    .join("\n\n")
)

const inheritedParentNames = computed(() =>
  inheritedScripts.value.map((script) => script.parentName).join(" · ")
)

const testScriptEditor = ref<any | null>(null)
const WRAP_LINES = useNestedSetting("WRAP_LINES", "httpTest")

useCodemirror(
  testScriptEditor,
  testScript,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      lineWrapping: WRAP_LINES,
      placeholder: `${t("test.javascript_code")}`,
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
  testScript.value += script
}

const clearContent = () => {
  testScript.value = ""
}
const tabService = useService(WorkspaceTabsService)

const currentRequest = computed(() =>
  tabService.currentActiveTab.value?.document.type === "request"
    ? tabService.currentActiveTab.value?.document.request
    : null
)

const { shouldEnableAIFeatures } = useAIExperiments()
const isModifyTestScriptModalOpen = ref(false)

const showModifyTestScriptModal = () => {
  isModifyTestScriptModalOpen.value = true
}
</script>

<style lang="scss" scoped>
:deep(.cm-panels) {
  @apply top-upperTertiaryStickyFold #{!important};
}
</style>
