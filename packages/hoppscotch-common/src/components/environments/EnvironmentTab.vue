<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <WorkspaceTabHeader
      v-model="name"
      badge-class="text-emerald-500"
      :placeholder="doc.isGlobal ? 'Global' : t('action.label')"
      :disabled="doc.isGlobal"
      @save="saveEnvironment"
    >
      <template #badge-icon>
        <icon-lucide-globe
          v-if="doc.isGlobal"
          class="h-3.5 w-3.5 text-emerald-500"
          aria-hidden="true"
        />
        <icon-lucide-layers
          v-else
          class="h-3.5 w-3.5 text-emerald-500"
          aria-hidden="true"
        />
      </template>
      <template #badge>
        {{ doc.isGlobal ? "Global" : t("environment.heading") }}
      </template>
    </WorkspaceTabHeader>

    <!-- Separate settings row: color lives below the shared header -->
    <div
      v-if="!doc.isGlobal"
      class="flex flex-shrink-0 items-center gap-3 border-b border-dividerLight bg-primaryLight px-4 py-2"
    >
      <span class="text-xs font-medium text-secondaryLight">
        {{ t("environment.color") }}
      </span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="swatch in ENVIRONMENT_COLORS"
          :key="swatch"
          type="button"
          class="h-5 w-5 rounded-full transition hover:scale-110"
          :class="
            doc.color === swatch
              ? 'ring-2 ring-accentDark ring-offset-1 ring-offset-primary'
              : 'ring-1 ring-inset ring-dividerDark'
          "
          :style="{ backgroundColor: swatch }"
          :aria-label="swatch"
          @click="doc.color = swatch"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear')"
          :icon="IconCircleSlash"
          class="!p-1 !rounded-full"
          :class="doc.color ? '!text-secondary' : '!text-secondaryDark'"
          @click="doc.color = ''"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-4">
      <div class="flex flex-col border border-divider rounded">
        <div
          v-if="evnExpandError"
          class="mb-2 w-full overflow-auto whitespace-normal rounded bg-primaryLight px-4 py-2 font-mono text-red-400"
        >
          {{ t("environment.nested_overflow") }}
        </div>
        <HoppSmartTabs v-model="selectedEnvOption" render-inactive-tabs>
          <template #actions>
            <div class="flex flex-1 items-center justify-between">
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                to="https://docs.hoppscotch.io/documentation/features/environments"
                blank
                :title="t('app.wiki')"
                :icon="IconHelpCircle"
              />
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :title="t('action.clear_all')"
                :icon="clearIcon"
                @click="clearContent()"
              />
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :icon="IconPlus"
                :title="t('add.new')"
                @click="addEnvironmentVariable"
              />
              <tippy
                ref="options"
                interactive
                trigger="click"
                theme="popover"
                :on-shown="() => tippyActions!.focus()"
              >
                <HoppButtonSecondary
                  v-tippy="{ theme: 'tooltip' }"
                  :title="t('action.more')"
                  :icon="IconMoreVertical"
                />
                <template #content="{ hide }">
                  <div
                    ref="tippyActions"
                    class="flex flex-col focus:outline-none"
                    tabindex="0"
                    role="menu"
                    @keyup.escape="hide()"
                  >
                    <HoppSmartItem
                      v-tippy="{ theme: 'tooltip' }"
                      :icon="IconCopyLeft"
                      :label="t('environment.replace_all_initial_with_current')"
                      @click="
                        () => {
                          doc.variables.forEach((row) => {
                            row.env.initialValue = row.env.currentValue
                          })
                          hide()
                        }
                      "
                    />
                    <HoppSmartItem
                      v-tippy="{ theme: 'tooltip' }"
                      :icon="IconCopyRight"
                      :label="t('environment.replace_all_current_with_initial')"
                      @click="
                        () => {
                          doc.variables.forEach((row) => {
                            row.env.currentValue = row.env.initialValue
                          })
                          hide()
                        }
                      "
                    />
                  </div>
                </template>
              </tippy>
            </div>
          </template>

          <HoppSmartTab
            v-for="tab in tabsData"
            :id="tab.id"
            :key="tab.id"
            :label="tab.label"
          >
            <div class="divide-y divide-dividerLight">
              <HoppSmartPlaceholder
                v-if="tab.variables.length === 0"
                :src="`/images/states/${colorMode.value}/blockchain.svg`"
                :alt="tab.emptyStateLabel"
                :text="tab.emptyStateLabel"
              >
                <template #body>
                  <HoppButtonSecondary
                    :label="`${t('add.new')}`"
                    filled
                    :icon="IconPlus"
                    @click="addEnvironmentVariable"
                  />
                </template>
              </HoppSmartPlaceholder>

              <template v-else>
                <div
                  v-for="(row, index) in tab.variables"
                  :key="`${tab.id}-${row.id}`"
                  class="flex divide-x divide-dividerLight"
                >
                  <input
                    v-model="row.env.key"
                    v-focus
                    class="flex flex-1 bg-transparent px-4 py-2 text-secondaryDark"
                    :placeholder="`${t('count.variable', {
                      count: index + 1,
                    })}`"
                    :name="'variable' + index"
                  />
                  <div class="flex items-center flex-1">
                    <SmartEnvInput
                      v-model="row.env.initialValue"
                      :placeholder="`${t('count.initialValue', { count: index + 1 })}`"
                      :envs="liveEnvs"
                      :name="'initialValue' + index"
                      :secret="tab.isSecret"
                      :select-text-on-mount="
                        row.env.key
                          ? row.env.key === doc.selectedVariableName
                          : false
                      "
                      :auto-complete-env="true"
                    />
                    <HoppButtonSecondary
                      v-tippy="{ theme: 'tooltip' }"
                      :title="t('environment.replace_initial_with_current')"
                      :icon="IconCopyLeft"
                      @click="
                        () => (row.env.initialValue = row.env.currentValue)
                      "
                    />
                  </div>

                  <div class="flex items-center flex-1">
                    <SmartEnvInput
                      v-model="row.env.currentValue"
                      :placeholder="`${t('count.currentValue', { count: index + 1 })}`"
                      :envs="liveEnvs"
                      :name="'currentValue' + index"
                      :secret="tab.isSecret"
                      :select-text-on-mount="
                        row.env.key
                          ? row.env.key === doc.selectedVariableName
                          : false
                      "
                      :auto-complete-env="true"
                    />
                    <HoppButtonSecondary
                      v-tippy="{ theme: 'tooltip' }"
                      :title="t('environment.replace_current_with_initial')"
                      :icon="IconCopyRight"
                      @click="
                        () => (row.env.currentValue = row.env.initialValue)
                      "
                    />
                  </div>

                  <div class="flex">
                    <HoppButtonSecondary
                      v-tippy="{ theme: 'tooltip' }"
                      :title="t('action.remove')"
                      :icon="IconTrash"
                      color="red"
                      @click="removeEnvironmentVariable(row.id)"
                    />
                  </div>
                </div>
              </template>
            </div>
          </HoppSmartTab>
        </HoppSmartTabs>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { useColorMode } from "@composables/theming"
import { useToast } from "@composables/toast"
import {
  Environment,
  GlobalEnvironment,
  parseTemplateStringE,
} from "@hoppscotch/data"
import { refAutoReset } from "@vueuse/core"
import { useService } from "dioc/vue"
import * as A from "fp-ts/Array"
import * as E from "fp-ts/Either"
import * as O from "fp-ts/Option"
import { flow, pipe } from "fp-ts/function"
import { computed, onMounted, ref, watch } from "vue"
import { TippyComponent } from "vue-tippy"
import { defineActionHandler } from "~/helpers/actions"
import { stripClientLocalValuesForWire } from "~/helpers/clientLocalVariables"
import { HoppEnvironmentDocument } from "~/helpers/tab/document"
import {
  createEnvironment,
  environmentsStore,
  globalEnv$,
  setGlobalEnvVariables,
  setSelectedEnvironmentIndex,
  updateEnvironment,
} from "~/newstore/environments"
import { platform } from "~/platform"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
// Explicit import — unplugin-vue-components may not rewrite this on a live
// dev server, leaving runtime _resolveComponent blank.
import WorkspaceTabHeader from "~/components/workspace/TabHeader.vue"
import IconCircleSlash from "~icons/lucide/circle-slash"
import IconCopyLeft from "~icons/lucide/clipboard-copy"
import IconCopyRight from "~icons/lucide/clipboard-paste"
import IconDone from "~icons/lucide/check"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconMoreVertical from "~icons/lucide/more-vertical"
import IconPlus from "~icons/lucide/plus"
import IconTrash from "~icons/lucide/trash"
import IconTrash2 from "~icons/lucide/trash-2"

const props = defineProps<{ modelValue: HoppTab<HoppEnvironmentDocument> }>()

const t = useI18n()
const toast = useToast()
const colorMode = useColorMode()
const tabs = useService(WorkspaceTabsService)
const secretEnvironmentService = useService(SecretEnvironmentService)
const currentEnvironmentValueService = useService(CurrentValueService)

// The document is mutated in place: the tab map is deeply reactive, so the
// tab head (name) and the dirty dot update without a round-trip through
// `update:modelValue`.
const doc = computed(() => props.modelValue.document)

// Swatches for the settings row under TabHeader (picker no longer lives in the bar).
const ENVIRONMENT_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
]

const options = ref<TippyComponent | null>(null)
const tippyActions = ref<HTMLDivElement | null>(null)

const name = computed({
  get: () => doc.value.name,
  set: (value: string) => (doc.value.name = value),
})

const selectedEnvOption = computed({
  get: () => doc.value.selectedOption,
  set: (value: "variables" | "secret") => {
    doc.value.selectedOption = value
  },
})

const tabsData = computed(() => {
  const nonSecret = doc.value.variables.filter((row) => !row.env.secret)
  const secret = doc.value.variables.filter((row) => row.env.secret)
  return [
    {
      id: "variables",
      label: t("environment.variables"),
      emptyStateLabel: t("empty.environments"),
      isSecret: false,
      variables: nonSecret,
    },
    {
      id: "secret",
      label: t("environment.secrets"),
      emptyStateLabel: t("empty.secret_environments"),
      isSecret: true,
      variables: secret,
    },
  ]
})

const clearIcon = refAutoReset<typeof IconTrash2 | typeof IconDone>(
  IconTrash2,
  1000
)

const globalEnv = useReadonlyStream(globalEnv$, {
  v: 2,
  variables: [],
} as GlobalEnvironment)

const draftVariables = computed(() => doc.value.variables.map((row) => row.env))

const evnExpandError = computed(() =>
  draftVariables.value.some(({ currentValue }) =>
    E.isLeft(parseTemplateStringE(currentValue, draftVariables.value))
  )
)

const liveEnvs = computed(() => {
  if (evnExpandError.value) return []
  const base = draftVariables.value.map((row) => ({
    ...row,
    sourceEnv: doc.value.name,
  }))
  if (doc.value.isGlobal) return base
  return [
    ...base,
    ...globalEnv.value.variables.map((x) => ({ ...x, sourceEnv: "Global" })),
  ]
})

const snapshot = () =>
  JSON.stringify({
    name: doc.value.name,
    color: doc.value.color,
    variables: doc.value.variables.map((row) => row.env),
  })

// `null` until the stored state is known: a tab restored mid-edit keeps its
// dirty flag until it is saved.
const savedSnapshot = ref<string | null>(null)

/**
 * Map store-backed secret / current values onto the draft rows.
 * On save, `varIndex` is the index within non-empty-key variables (both kinds
 * interleaved) — match that layout so a restored draft lines up.
 */
function rehydrateLocalValues() {
  const envID = doc.value.isGlobal ? "Global" : doc.value.environmentID
  let nonEmptyIndex = 0
  for (const row of doc.value.variables) {
    if (row.env.key === "") continue
    if (row.env.secret) {
      const secret = secretEnvironmentService.getSecretEnvironmentVariable(
        envID,
        nonEmptyIndex
      )
      if (secret) {
        row.env.currentValue = secret.value ?? row.env.currentValue
        row.env.initialValue = secret.initialValue ?? row.env.initialValue
      }
    } else {
      const current = currentEnvironmentValueService.getEnvironmentVariable(
        envID,
        nonEmptyIndex
      )
      if (current?.currentValue !== undefined) {
        row.env.currentValue = current.currentValue
      }
    }
    nonEmptyIndex++
  }
}

onMounted(() => {
  // Secret / current values are never written into the tabs state — rehydrate
  // from local stores on (re)mount so a restored draft is complete.
  rehydrateLocalValues()
  if (!doc.value.isDirty) savedSnapshot.value = snapshot()
})

watch(snapshot, (current) => {
  if (savedSnapshot.value === null) return
  doc.value.isDirty = current !== savedSnapshot.value
})

const clearContent = () => {
  doc.value.variables = doc.value.variables.filter((row) =>
    selectedEnvOption.value === "secret" ? !row.env.secret : row.env.secret
  )
  clearIcon.value = IconDone
  toast.success(`${t("state.cleared")}`)
}

const addEnvironmentVariable = () => {
  doc.value.variables.push({
    id: doc.value.idTicker++,
    env: {
      key: "",
      currentValue: "",
      initialValue: "",
      secret: selectedEnvOption.value === "secret",
    },
  })
}

const removeEnvironmentVariable = (id: number) => {
  const index = doc.value.variables.findIndex((row) => row.id === id)
  if (index !== -1) doc.value.variables.splice(index, 1)
}

const saveEnvironment = () => {
  const d = doc.value

  if (!d.name) {
    toast.error(`${t("environment.invalid_name")}`)
    return
  }
  if (d.name.trim().length === 0) {
    toast.error(`${t("environment.short_name")}`)
    return
  }

  const filteredVariables = pipe(
    d.variables,
    A.filterMap(
      flow(
        O.fromPredicate((row) => row.env.key !== ""),
        O.map((row) => row.env)
      )
    )
  )

  const secretVariables = pipe(
    filteredVariables,
    A.filterMapWithIndex((i, e) =>
      e.secret
        ? O.some({
            key: e.key,
            value: e.currentValue,
            varIndex: i,
            initialValue: e.initialValue,
          })
        : O.none
    )
  )

  const nonSecretVariables = pipe(
    filteredVariables,
    A.filterMapWithIndex((i, e) =>
      !e.secret
        ? O.some({
            key: e.key,
            currentValue: e.currentValue,
            varIndex: i,
            isSecret: e.secret ?? false,
          })
        : O.none
    )
  )

  // Always write to both stores (even when an array is empty) so a save
  // that removes secrets/non-secrets clears the prior entries instead of
  // leaving stale values keyed by old `varIndex` slots.
  const localID = d.isGlobal ? "Global" : d.environmentID
  secretEnvironmentService.addSecretEnvironment(localID, secretVariables)
  currentEnvironmentValueService.addEnvironment(localID, nonSecretVariables)

  const variables = stripClientLocalValuesForWire(filteredVariables)

  const environmentUpdated: Environment = {
    v: 3,
    id: d.environmentID,
    name: d.name,
    variables,
    color: d.color || undefined,
  }

  if (d.isNew) {
    createEnvironment(d.name, variables, d.environmentID, d.color || undefined)
    const newIndex = environmentsStore.value.environments.findIndex(
      (env) => env.id === d.environmentID
    )
    if (newIndex !== -1) {
      setSelectedEnvironmentIndex({ type: "MY_ENV", index: newIndex })
    }
    d.isNew = false
    toast.success(`${t("environment.created")}`)
    platform.analytics?.logEvent({
      type: "HOPP_CREATE_ENVIRONMENT",
      workspaceType: "personal",
    })
  } else if (d.isGlobal) {
    setGlobalEnvVariables(environmentUpdated)
    toast.success(`${t("environment.updated")}`)
  } else {
    const index = environmentsStore.value.environments.findIndex(
      (env) => env.id === d.environmentID
    )
    if (index === -1) {
      // Environment was deleted while this tab sat open
      toast.error(t("error.something_went_wrong"))
      return
    }
    updateEnvironment(index, environmentUpdated)
    toast.success(`${t("environment.updated")}`)
  }

  savedSnapshot.value = snapshot()
  d.isDirty = false
}

defineActionHandler(
  "request-response.save",
  saveEnvironment,
  computed(() => tabs.currentActiveTab.value?.id === props.modelValue.id)
)
</script>
