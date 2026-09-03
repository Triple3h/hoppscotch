<template>
  <div
    class="flex justify-between border-b border-dividerLight px-4 py-2 text-tiny text-secondaryLight"
  >
    <div class="flex items-center overflow-x-auto whitespace-nowrap">
      <span class="truncate">
        {{ currentWorkspace }}
      </span>
      <icon-lucide-chevron-right v-if="section" class="mx-2" />
      {{ section }}
    </div>
    <slot name="item"></slot>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "~/composables/i18n"

const t = useI18n()

defineProps<{
  section?: string
  isOnlyPersonal?: boolean
}>()

const currentWorkspace = t("workspace.personal")
</script>
