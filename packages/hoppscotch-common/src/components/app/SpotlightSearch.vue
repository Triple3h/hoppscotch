<template>
  <button
    class="relative flex flex-1 cursor-text items-center justify-between self-stretch overflow-hidden rounded border border-divider bg-primary px-3 text-secondaryLight transition hover:border-dividerDark hover:bg-primaryLight hover:text-secondary focus-visible:border-accent focus-visible:bg-primaryLight focus-visible:text-secondary"
    @click="invokeAction('modals.search.toggle', undefined, 'mouseclick')"
  >
    <span class="inline-flex flex-1 items-center">
      <icon-lucide-search class="svg-icons mr-2" />

      {{ t("app.search") }}
    </span>
    <span class="flex space-x-1">
      <kbd class="shortcut-key">{{ getPlatformSpecialKey() }}</kbd>
      <kbd class="shortcut-key">K</kbd>
    </span>
  </button>
</template>

<script lang="ts" setup>
import { useI18n } from "~/composables/i18n"
import { invokeAction } from "~/helpers/actions"
import { getPlatformSpecialKey } from "~/helpers/platformutils"

const t = useI18n()
</script>
