<template>
  <div
    class="flex min-w-0 max-w-full items-stretch overflow-hidden bg-primary"
    :class="
      isScopeSelector
        ? 'h-10 w-full rounded'
        : 'mr-2 h-9 w-fit rounded border border-divider'
    "
    :style="
      selectedEnvTint && !isScopeSelector
        ? { backgroundColor: selectedEnvTint }
        : undefined
    "
  >
    <tippy
      interactive
      trigger="click"
      theme="popover"
      :on-shown="() => envSearchInput?.focus()"
    >
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-secondaryDark focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        :class="{
          'hover:bg-primaryLight': !selectedEnvColor || isScopeSelector,
        }"
        :aria-label="`${t('environment.select')}: ${selectedEnvName}`"
        :title="`${t('environment.select')}: ${selectedEnvName}`"
      >
        <span
          class="h-2.5 w-2.5 flex-none rounded-full border border-dividerDark"
          :class="selectedEnvColor ? '' : 'bg-primary'"
          :style="selectedEnvColor ? { backgroundColor: selectedEnvColor } : {}"
        />
        <span class="min-w-0 max-w-40 flex-1 truncate text-left font-medium">
          {{ selectedEnvName }}
        </span>
        <icon-lucide-chevron-down
          class="svg-icons !h-4 !w-4 flex-none text-secondaryLight"
          aria-hidden="true"
        />
      </button>
      <template #content="{ hide }">
        <div
          role="dialog"
          :aria-label="t('environment.select')"
          class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 focus:outline-none"
          @keyup.escape="hide()"
        >
          <div class="relative flex flex-1 items-center">
            <icon-lucide-search
              class="svg-icons pointer-events-none absolute left-2 text-secondaryLight"
            />
            <input
              ref="envSearchInput"
              v-model="filterText"
              type="text"
              :aria-label="t('action.search')"
              :placeholder="`${t('action.search')}`"
              class="w-full rounded border border-transparent bg-primaryLight py-1.5 pl-8 pr-2 text-body text-secondaryDark placeholder-secondaryLight transition focus:border-dividerDark focus:outline-none"
            />
          </div>
          <div class="flex max-h-72 flex-col overflow-y-auto">
            <HoppSmartItem
              v-if="!isScopeSelector"
              :label="`${t('environment.no_environment')}`"
              :icon="
                selectedEnvironmentIndex.type === 'NO_ENV_SELECTED'
                  ? IconCheck
                  : IconCircleSlash
              "
              class="!px-3 !py-1.5"
              :class="
                selectedEnvironmentIndex.type === 'NO_ENV_SELECTED'
                  ? 'bg-primaryDark'
                  : ''
              "
              @click="
                () => {
                  selectedEnvironmentIndex = { type: 'NO_ENV_SELECTED' }
                  hide()
                }
              "
            />
            <HoppSmartItem
              v-else-if="isScopeSelector && modelValue"
              :label="t('environment.global')"
              :icon="modelValue.type === 'global' ? IconCheck : IconGlobe"
              class="!px-3 !py-1.5"
              :class="modelValue.type === 'global' ? 'bg-primaryDark' : ''"
              @click="
                () => {
                  $emit('update:modelValue', {
                    type: 'global',
                    variables: globalVals.variables,
                  })
                  hide()
                }
              "
            />
            <HoppSmartItem
              v-for="{ env, index } in filteredAndAlphabetizedPersonalEnvs"
              :key="`gen-${index}`"
              :label="env.name"
              :icon="isEnvActive(index) ? IconCheck : IconLayers"
              class="!px-3 !py-1.5"
              :class="
                isEnvActive(index) && !selectedEnvTint ? 'bg-primaryDark' : ''
              "
              :style="
                isEnvActive(index) && selectedEnvTint
                  ? { backgroundColor: selectedEnvTint }
                  : undefined
              "
              @click="
                () => {
                  handleEnvironmentChange(index, {
                    type: 'my-environment',
                    environment: env,
                  })
                  hide()
                }
              "
            />
            <HoppSmartPlaceholder
              v-if="filteredAndAlphabetizedPersonalEnvs.length === 0"
              class="break-words"
              :src="
                filterText
                  ? undefined
                  : `/images/states/${colorMode.value}/blockchain.svg`
              "
              :alt="
                filterText
                  ? `${t('empty.search_environment')}`
                  : t('empty.environments')
              "
              :text="
                filterText
                  ? `${t('empty.search_environment')} '${filterText}'`
                  : t('empty.environments')
              "
            >
              <template v-if="filterText" #icon>
                <icon-lucide-search class="svg-icons opacity-75" />
              </template>
            </HoppSmartPlaceholder>
          </div>
          <div
            v-if="!isScopeSelector"
            class="mt-1 flex flex-col border-t border-dividerLight pt-1"
          >
            <HoppSmartItem
              :icon="IconPlus"
              :label="t('environment.create_new')"
              class="!px-3 !py-1.5"
              @click="
                () => {
                  invokeAction('modals.environment.new', {})
                  hide()
                }
              "
            />
          </div>
        </div>
      </template>
    </tippy>
    <span v-if="!isScopeSelector" class="flex flex-none">
      <tippy
        interactive
        trigger="click"
        theme="popover"
        :on-shown="() => envQuickPeekActions!.focus()"
      >
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="`${t('environment.quick_peek')}`"
          :icon="IconEye"
          class="h-full !px-2.5"
          :class="
            selectedEnvColor
              ? '!bg-transparent hover:!bg-transparent focus-visible:!bg-transparent'
              : 'hover:bg-primaryLight focus-visible:bg-primaryLight'
          "
        />
        <template #content="{ hide }">
          <div
            ref="envQuickPeekActions"
            role="menu"
            class="flex flex-col focus:outline-none"
            tabindex="0"
            @keyup.escape="hide()"
          >
            <div
              class="sticky top-0 flex items-center justify-between truncate rounded border border-divider bg-primary pl-4 font-semibold text-secondaryDark"
            >
              {{ t("environment.global_variables") }}
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :title="t('action.edit')"
                :icon="IconEdit"
                @click="
                  () => {
                    editGlobalEnv()
                    hide()
                  }
                "
              />
            </div>
            <div class="my-2 flex flex-1 flex-col space-y-2 pl-4 pr-2">
              <div class="flex flex-1 space-x-4">
                <span
                  class="min-w-[9rem] w-1/4 truncate text-tiny font-semibold"
                >
                  {{ t("environment.name") }}
                </span>
                <span
                  class="min-w-[4rem] w-full truncate text-tiny font-semibold"
                >
                  {{ t("environment.initial_value") }}
                </span>
                <span
                  class="min-w-[4rem] w-full truncate text-tiny font-semibold"
                >
                  {{ t("environment.current_value") }}
                </span>
              </div>
              <div
                v-for="(variable, index) in globalEnvs"
                :key="index"
                class="flex flex-1 space-x-4"
              >
                <span class="min-w-[9rem] w-1/4 truncate text-secondaryLight">
                  {{ variable.key }}
                </span>
                <span class="min-w-[4rem] w-full truncate text-secondaryLight">
                  {{ variable.initialValue }}
                </span>
                <span class="min-w-[4rem] w-full truncate text-secondaryLight">
                  {{ variable.currentValue }}
                </span>
              </div>
              <div v-if="globalEnvs.length === 0" class="text-secondaryLight">
                {{ t("environment.empty_variables") }}
              </div>
            </div>
            <div
              class="sticky top-0 mt-2 flex items-center justify-between truncate rounded border border-divider bg-primary pl-4 font-semibold text-secondaryDark"
              :class="{
                'bg-primaryLight': !selectedEnv.variables,
              }"
            >
              {{ t("environment.list") }}
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :disabled="!selectedEnv.variables"
                :title="t('action.edit')"
                :icon="IconEdit"
                @click="
                  () => {
                    editEnv()
                    hide()
                  }
                "
              />
            </div>
            <div
              v-if="selectedEnv.type === 'NO_ENV_SELECTED'"
              class="my-2 flex flex-1 flex-col pl-4 text-secondaryLight"
            >
              {{ t("environment.no_active_environment") }}
            </div>
            <div v-else class="my-2 flex flex-1 flex-col space-y-2 pl-4 pr-2">
              <div class="flex flex-1 space-x-4">
                <span
                  class="min-w-[9rem] w-1/4 truncate text-tiny font-semibold"
                >
                  {{ t("environment.name") }}
                </span>
                <span
                  class="min-w-[4rem] w-full truncate text-tiny font-semibold"
                >
                  {{ t("environment.initial_value") }}
                </span>
                <span
                  class="min-w-[4rem] w-full truncate text-tiny font-semibold"
                >
                  {{ t("environment.current_value") }}
                </span>
              </div>
              <div
                v-for="(variable, index) in environmentVariables"
                :key="index"
                class="flex flex-1 space-x-4"
              >
                <span class="min-w-[9rem] w-1/4 truncate text-secondaryLight">
                  {{ variable.key }}
                </span>
                <span class="min-w-[4rem] w-full truncate text-secondaryLight">
                  {{ variable.initialValue }}
                </span>
                <span class="min-w-[4rem] w-full truncate text-secondaryLight">
                  {{ variable.currentValue }}
                </span>
              </div>
              <div
                v-if="environmentVariables.length === 0"
                class="text-secondaryLight"
              >
                {{ t("environment.empty_variables") }}
              </div>
            </div>
          </div>
        </template>
      </tippy>
    </span>
  </div>
</template>

<script lang="ts" setup>
import { useColorMode } from "@composables/theming"
import { Environment, GlobalEnvironment } from "@hoppscotch/data"
import { useService } from "dioc/vue"
import { computed, onMounted, ref } from "vue"
import { TippyComponent } from "vue-tippy"
import { useI18n } from "~/composables/i18n"
import { useReadonlyStream, useStream } from "~/composables/stream"
import { invokeAction } from "~/helpers/actions"
import { sortPersonalEnvironmentsAlphabetically } from "~/helpers/utils/sortEnvironmentsAlphabetically"
import { maskSecretValue } from "~/helpers/utils/secretMask"
import {
  environments$,
  globalEnv$,
  selectedEnvironmentIndex$,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import IconCheck from "~icons/lucide/check"
import IconCircleSlash from "~icons/lucide/circle-slash"
import IconEdit from "~icons/lucide/edit"
import IconEye from "~icons/lucide/eye"
import IconGlobe from "~icons/lucide/globe"
import IconLayers from "~icons/lucide/layers"
import IconPlus from "~icons/lucide/plus"

export type Scope =
  | {
      type: "global"
      variables: GlobalEnvironment["variables"]
    }
  | {
      type: "my-environment"
      environment: Environment
      index: number
    }
const props = defineProps<{
  isScopeSelector?: boolean
  modelValue?: Scope
}>()
const emit = defineEmits<{
  (e: "update:modelValue", data: Scope): void
}>()

const t = useI18n()

const colorMode = useColorMode()

const filterText = ref("")

const myEnvironments = useReadonlyStream(environments$, [])

const currentEnvironmentValueService = useService(CurrentValueService)

const secretEnvironmentService = useService(SecretEnvironmentService)

// Sort environments alphabetically by default and filter based on search
const filteredAndAlphabetizedPersonalEnvs = computed(() => {
  const envs = sortPersonalEnvironmentsAlphabetically(
    myEnvironments.value,
    "asc"
  )

  if (!filterText.value) return envs

  // Ensure specifying whitespace characters alone result in the empty state for no search results
  const trimmedFilterText = filterText.value.trim().toLowerCase()

  return envs.filter(({ env }) =>
    trimmedFilterText
      ? env.name.toLowerCase().includes(trimmedFilterText)
      : false
  )
})

const handleEnvironmentChange = (
  index: number,
  env?: {
    type: "my-environment"
    environment: Environment
  }
) => {
  if (props.isScopeSelector && env) {
    emit("update:modelValue", {
      type: "my-environment",
      environment: env.environment,
      index,
    })
  } else {
    if (env) {
      selectedEnvironmentIndex.value = {
        type: "MY_ENV",
        index,
      }
    }
  }
}

const selectedEnvColor = computed(() => {
  if (selectedEnv.value.type !== "MY_ENV") return ""
  return myEnvironments.value[selectedEnv.value.index]?.color ?? ""
})

const selectedEnvTint = computed(() =>
  selectedEnvColor.value
    ? `color-mix(in srgb, ${selectedEnvColor.value} 16%, var(--primary-color))`
    : ""
)

const selectedEnvName = computed(() =>
  selectedEnv.value.type === "NO_ENV_SELECTED"
    ? t("environment.no_environment")
    : selectedEnv.value.type === "global"
      ? t("environment.global")
      : selectedEnv.value.name
)

const isEnvActive = (id: string | number) => {
  if (props.isScopeSelector) {
    if (props.modelValue?.type === "my-environment") {
      return props.modelValue.index === id
    }
  } else {
    if (selectedEnvironmentIndex.value.type === "MY_ENV") {
      return selectedEnv.value.index === id
    }
  }
}

const selectedEnvironmentIndex = useStream(
  selectedEnvironmentIndex$,
  { type: "NO_ENV_SELECTED" },
  setSelectedEnvironmentIndex
)

const selectedEnv = computed(() => {
  if (props.isScopeSelector) {
    if (props.modelValue?.type === "my-environment") {
      return {
        type: "MY_ENV",
        index: props.modelValue.index,
        name: props.modelValue.environment?.name,
        variables: props.modelValue.environment?.variables,
        id: props.modelValue.environment.id,
      }
    }
    return {
      type: "global",
      name: "Global",
      variables: globalVals.value.variables,
    }
  }
  if (selectedEnvironmentIndex.value.type === "MY_ENV") {
    const environment =
      myEnvironments.value[selectedEnvironmentIndex.value.index]
    return {
      type: "MY_ENV",
      index: selectedEnvironmentIndex.value.index,
      name: environment.name,
      variables: environment.variables,
      id: environment.id,
    }
  }
  return { type: "NO_ENV_SELECTED" }
})

// Set the selected environment as initial scope value
onMounted(() => {
  if (props.isScopeSelector) {
    if (
      selectedEnvironmentIndex.value.type === "MY_ENV" &&
      selectedEnvironmentIndex.value.index !== undefined
    ) {
      emit("update:modelValue", {
        type: "my-environment",
        environment: myEnvironments.value[selectedEnvironmentIndex.value.index],
        index: selectedEnvironmentIndex.value.index,
      })
    } else {
      emit("update:modelValue", {
        type: "global",
        variables: globalVals.value.variables,
      })
    }
  }
})

// Template refs
const envSearchInput = ref<HTMLInputElement | null>(null)
const envQuickPeekActions = ref<TippyComponent | null>(null)

const globalVals = useReadonlyStream(globalEnv$, {
  v: 2,
  variables: [],
} as GlobalEnvironment)

// Resolve each variable's display values. Secrets are masked by length (an
// unset secret renders empty, not a fixed `********`) so the popover matches the
// env tooltip and never claims a value exists when it doesn't.
const resolveDisplayVariable = (
  variable: Environment["variables"][number],
  envID: string,
  index: number
) => {
  if (variable.secret) {
    const secretValue =
      secretEnvironmentService.getSecretEnvironmentVariableValue(envID, index)
    return {
      ...variable,
      initialValue: maskSecretValue(secretValue?.initialValue),
      currentValue: maskSecretValue(secretValue?.value),
    }
  }
  return {
    ...variable,
    currentValue:
      currentEnvironmentValueService.getEnvironmentVariableValue(
        envID,
        index
      ) ?? "",
  }
}

const globalEnvs = computed(() => {
  return (globalVals.value?.variables ?? []).map((variable, index) =>
    resolveDisplayVariable(variable, "Global", index)
  )
})

const environmentVariables = computed(() => {
  if (selectedEnv.value.variables && selectedEnv.value.id) {
    const envID = selectedEnv.value.id
    return selectedEnv.value.variables.map((variable, index) =>
      resolveDisplayVariable(variable, envID, index)
    )
  }
  return []
})

const editGlobalEnv = () => {
  invokeAction("modals.global.environment.update", {})
}

const editEnv = () => {
  if (selectedEnv.value.type === "MY_ENV" && selectedEnv.value.name) {
    invokeAction("modals.my.environment.edit", {
      envName: selectedEnv.value.name,
    })
  }
}
</script>
