<template>
  <HoppSmartTabs v-model="activeTab" :styles="tabsStyles" render-inactive-tabs>
    <HoppSmartTab id="headers" :label="`${t('tab.headers')}`">
      <HttpHeaders
        v-model="collection"
        :is-collection-property="true"
        :envs="envs"
        @change-tab="(tab) => (activeTab = tab)"
      />
      <div class="bg-bannerInfo px-4 py-2 flex items-center sticky bottom-0">
        <icon-lucide-info class="svg-icons mr-2" />
        {{ t("helpers.collection_properties_header") }}
      </div>
    </HoppSmartTab>

    <HoppSmartTab id="authorization" :label="`${t('tab.authorization')}`">
      <HttpAuthorization
        v-model="auth"
        :is-collection-property="true"
        :is-root-collection="isRootCollection"
        :inherited-properties="inheritedProperties"
        :envs="envs"
        :source="source"
      />
      <div class="bg-bannerInfo px-4 py-2 flex items-center sticky bottom-0">
        <icon-lucide-info class="svg-icons mr-2" />
        {{ t("helpers.collection_properties_authorization") }}
      </div>
    </HoppSmartTab>

    <!-- Collection variables is only available for REST collections for now -->
    <HoppSmartTab
      v-if="source === 'REST'"
      id="variables"
      :label="`${t('tab.variables')}`"
    >
      <CollectionsVariables
        v-model="variables"
        :inherited-properties="inheritedProperties"
        :collection-store-key="collectionStoreKey"
      />
    </HoppSmartTab>

    <HoppSmartTab
      v-if="source === 'REST'"
      id="scripts"
      :label="`${t('tab.scripts')}`"
    >
      <div class="flex flex-col flex-1">
        <HoppSmartTabs
          v-model="activeScriptsTab"
          styles="sticky overflow-x-auto flex-shrink-0 bg-primary top-0 z-10"
          render-inactive-tabs
        >
          <HoppSmartTab
            id="pre-request"
            :label="`${t('tab.pre_request_script')}`"
            :indicator="hasActualScript(collection.preRequestScript)"
          >
            <div class="flex flex-col flex-1">
              <div class="h-64 overflow-hidden relative">
                <MonacoScriptEditor
                  v-if="
                    EXPERIMENTAL_SCRIPTING_SANDBOX &&
                    activeTab === 'scripts' &&
                    activeScriptsTab === 'pre-request'
                  "
                  v-model="preRequestScriptModel"
                  type="pre-request"
                />
                <div
                  v-else
                  ref="preRequestEditor"
                  class="h-full absolute inset-0"
                ></div>
              </div>
            </div>
          </HoppSmartTab>

          <HoppSmartTab
            id="test-script"
            :label="`${t('tab.post_request_script')}`"
            :indicator="hasActualScript(collection.testScript)"
          >
            <div class="flex flex-col flex-1">
              <div
                class="h-64 border-b border-dividerLight overflow-hidden relative"
              >
                <MonacoScriptEditor
                  v-if="
                    EXPERIMENTAL_SCRIPTING_SANDBOX &&
                    activeTab === 'scripts' &&
                    activeScriptsTab === 'test-script'
                  "
                  v-model="testScriptModel"
                  type="post-request"
                />
                <div
                  v-else
                  ref="testScriptEditor"
                  class="h-full absolute inset-0"
                ></div>
              </div>
            </div>
          </HoppSmartTab>
        </HoppSmartTabs>

        <div class="bg-bannerInfo px-4 py-2 flex items-center sticky bottom-0">
          <icon-lucide-info class="svg-icons mr-2" />
          {{ t("helpers.collection_properties_scripts") }}
        </div>
      </div>
    </HoppSmartTab>

    <HoppSmartTab
      v-if="showDetails"
      :id="'details'"
      :label="t('collection.details')"
    >
      <div
        class="flex flex-shrink-0 items-center justify-between border-b border-dividerLight bg-primary pl-4"
      >
        <span>{{ t("collection_runner.collection_id") }}</span>

        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/clients/cli/overview#running-collections-present-on-the-api-client"
          blank
          :title="t('app.wiki')"
          :icon="IconHelpCircle"
        />
      </div>

      <div class="p-4">
        <div
          class="flex items-center justify-between py-2 px-4 rounded-md bg-primaryLight select-text"
        >
          <div class="text-secondaryDark">
            {{ collectionPath }}
          </div>

          <HoppButtonSecondary
            filled
            :icon="copyIcon"
            @click="copyCollectionID"
          />
        </div>
      </div>

      <div class="bg-bannerInfo px-4 py-2 flex items-center sticky bottom-0">
        <icon-lucide-info class="svg-icons mr-2" />
        {{ t("collection_runner.cli_collection_id_description") }}
      </div>
    </HoppSmartTab>
  </HoppSmartTabs>
</template>

<script setup lang="ts">
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { hasActualScript } from "@hoppscotch/js-sandbox/scripting"
import { refAutoReset } from "@vueuse/core"
import { computed, reactive, ref } from "vue"
import {
  EditableCollectionProperties,
  HoppCollectionAuth,
} from "~/helpers/collection/collectionProperties"
import { useToast } from "~/composables/toast"
import { useSetting } from "~/composables/settings"
import preRequestCompleter from "~/helpers/editor/completion/preRequest"
import testScriptCompleter from "~/helpers/editor/completion/testScript"
import preRequestLinter from "~/helpers/editor/linting/preRequest"
import testScriptLinter from "~/helpers/editor/linting/testScript"
import { copyToClipboard } from "~/helpers/utils/clipboard"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import {
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue,
} from "~/newstore/environments"
import { transformInheritedCollectionVariablesToAggregateEnv } from "~/helpers/utils/inheritedCollectionVarTransformer"
import IconCheck from "~icons/lucide/check"
import IconCopy from "~icons/lucide/copy"
import IconHelpCircle from "~icons/lucide/help-circle"

const props = withDefaults(
  defineProps<{
    inheritedProperties?: HoppInheritedProperty
    // Key the collection's secret/current values are stored under
    collectionStoreKey?: string
    collectionPath: string
    isRootCollection: boolean
    source: "REST" | "GraphQL"
    showDetails?: boolean
    tabsStyles?: string
  }>(),
  {
    showDetails: false,
    tabsStyles: "sticky overflow-x-auto flex-shrink-0 bg-primary top-0 z-10",
  }
)

const collection = defineModel<EditableCollectionProperties>("collection", {
  required: true,
})
const activeTab = defineModel<string>("activeTab", { required: true })

const t = useI18n()
const toast = useToast()

const activeScriptsTab = ref<"pre-request" | "test-script">("pre-request")

const aggregateEnvs = useReadonlyStream(
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue()
)

const envs = computed(() => {
  const collectionVars = collection.value.variables.map((v) => ({
    key: v.key,
    currentValue: v.currentValue,
    initialValue: v.initialValue,
    sourceEnv: "CollectionVariable",
    sourceEnvID: props.collectionStoreKey ?? "",
    secret: v.secret,
  }))

  const inheritedVars = transformInheritedCollectionVariablesToAggregateEnv(
    props.inheritedProperties?.variables ?? [],
    true
  )

  // Note: request-level variables are intentionally NOT merged here since
  // there is no single active request in scope when editing collection-level
  // properties.
  return [...collectionVars, ...inheritedVars, ...aggregateEnvs.value]
})

const auth = computed({
  get: () => collection.value.auth as HoppCollectionAuth,
  set: (value) => (collection.value = { ...collection.value, auth: value }),
})

const variables = computed({
  get: () => collection.value.variables,
  set: (value) =>
    (collection.value = { ...collection.value, variables: value }),
})

const EXPERIMENTAL_SCRIPTING_SANDBOX = useSetting(
  "EXPERIMENTAL_SCRIPTING_SANDBOX"
)

const preRequestEditor = ref<any | null>(null)
const testScriptEditor = ref<any | null>(null)

const preRequestScriptModel = computed({
  get: () => collection.value.preRequestScript,
  set: (val: string) => {
    collection.value = { ...collection.value, preRequestScript: val }
  },
})

const testScriptModel = computed({
  get: () => collection.value.testScript,
  set: (val: string) => {
    collection.value = { ...collection.value, testScript: val }
  },
})

useCodemirror(
  preRequestEditor,
  preRequestScriptModel,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      lineWrapping: true,
      placeholder: `${t("preRequest.javascript_code")}`,
      readOnly: false,
    },
    linter: preRequestLinter,
    completer: preRequestCompleter,
    environmentHighlights: false,
    contextMenuEnabled: false,
  })
)

useCodemirror(
  testScriptEditor,
  testScriptModel,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      lineWrapping: true,
      placeholder: `${t("test.javascript_code")}`,
      readOnly: false,
    },
    linter: testScriptLinter,
    completer: testScriptCompleter,
    environmentHighlights: false,
    contextMenuEnabled: false,
  })
)

const copyIcon = refAutoReset<typeof IconCopy | typeof IconCheck>(
  IconCopy,
  1000
)

const copyCollectionID = () => {
  copyToClipboard(props.collectionPath)
  copyIcon.value = IconCheck
  toast.success(t("state.copied_to_clipboard"))
}
</script>
