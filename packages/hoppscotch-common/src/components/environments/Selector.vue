<template>
  <div class="flex divide-x divide-dividerLight">
    <tippy
      interactive
      trigger="click"
      theme="popover"
      :on-shown="() => envSelectorActions!.focus()"
    >
      <HoppSmartSelectWrapper
        v-tippy="{ theme: 'tooltip' }"
        :title="`${t('environment.select')}`"
      >
        <HoppButtonSecondary
          :icon="IconLayers"
          :label="
            mdAndLarger
              ? selectedEnv.type !== 'NO_ENV_SELECTED'
                ? selectedEnv.name
                : `${t('environment.select')}`
              : ''
          "
          class="flex-1 !justify-start rounded-none pr-8"
        />
      </HoppSmartSelectWrapper>
      <template #content="{ hide }">
        <div
          ref="envSelectorActions"
          role="menu"
          class="flex flex-col space-y-2 focus:outline-none"
          tabindex="0"
          @keyup.escape="hide()"
        >
          <SmartEnvInput
            v-model="filterText"
            :placeholder="`${t('action.search')}`"
            :context-menu-enabled="false"
            class="border border-dividerDark focus:border-primaryDark rounded"
          />
          <HoppSmartItem
            v-if="!isScopeSelector"
            class="my-2"
            :label="`${t('environment.no_environment')}`"
            :info-icon="
              selectedEnvironmentIndex.type === 'NO_ENV_SELECTED'
                ? IconCheck
                : undefined
            "
            :active-info-icon="
              selectedEnvironmentIndex.type === 'NO_ENV_SELECTED'
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
            :icon="IconGlobe"
            :info-icon="modelValue.type === 'global' ? IconCheck : undefined"
            :active-info-icon="modelValue.type === 'global'"
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
          <HoppSmartTabs
            v-model="selectedEnvTab"
            :styles="`sticky overflow-x-auto mb-2 border border-divider rounded flex-shrink-0 z-10 top-0 bg-primaryLight`"
            render-inactive-tabs
          >
            <HoppSmartTab
              :id="'my-environments'"
              :label="`${t('environment.my_environments')}`"
            >
              <HoppSmartItem
                v-for="{ env, index } in filteredAndAlphabetizedPersonalEnvs"
                :key="`gen-${index}`"
                :icon="IconLayers"
                :label="env.name"
                :info-icon="isEnvActive(index) ? IconCheck : undefined"
                :active-info-icon="isEnvActive(index)"
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
            </HoppSmartTab>
          </HoppSmartTabs>
        </div>
      </template>
    </tippy>
    <span class="flex">
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
          class="!px-4"
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
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core"
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
import IconEdit from "~icons/lucide/edit"
import IconEye from "~icons/lucide/eye"
import IconGlobe from "~icons/lucide/globe"
import IconLayers from "~icons/lucide/layers"

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

const breakpoints = useBreakpoints(breakpointsTailwind)
const mdAndLarger = breakpoints.greater("md")

const t = useI18n()

const colorMode = useColorMode()

type EnvironmentType = "my-environments"

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

const selectedEnvTab = ref<EnvironmentType>("my-environments")

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
const envSelectorActions = ref<TippyComponent | null>(null)
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
