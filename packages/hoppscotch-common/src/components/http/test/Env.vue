<template>
  <span v-if="show">
    {{ envName ?? t("filter.none") }}
  </span>
</template>

<script lang="ts" setup>
import { computed, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { useReadonlyStream, useStream } from "~/composables/stream"
import {
  environments$,
  selectedEnvironmentIndex$,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"

const t = useI18n()

withDefaults(
  defineProps<{
    show?: boolean
  }>(),
  {
    show: true,
  }
)

const emit = defineEmits<{
  (e: "select-env", data: any): void
}>()

const envName = computed(() => selectedEnv.value?.name ?? null)

const currentEnv = useStream(
  selectedEnvironmentIndex$,
  { type: "NO_ENV_SELECTED" },
  setSelectedEnvironmentIndex
)

const myEnvironments = useReadonlyStream(environments$, [])

export type CurrentEnv = {
  type: "MY_ENV"
  index: number
  name: string
} | null

const selectedEnv = computed<CurrentEnv>(() => {
  if (currentEnv.value.type === "MY_ENV") {
    const environment = myEnvironments.value[currentEnv.value.index]
    return {
      type: "MY_ENV",
      index: currentEnv.value.index,
      name: environment.name,
    }
  }
  return null // Return null or a default value if no environment is selected
})

watch(
  () => selectedEnv.value,
  (newVal) => {
    if (newVal) emit("select-env", newVal)
  },
  { immediate: true }
)
</script>
