<template>
  <div
    class="relative flex w-72 flex-col rounded-lg border border-divider bg-popover p-4 text-secondary shadow-lg"
  >
    <button
      class="absolute right-3 top-3 text-secondaryLight transition-colors hover:text-secondaryDark"
      @click="$emit('close-toast')"
    >
      <IconLucideX />
    </button>
    <div class="flex flex-col space-y-3 pr-6">
      <p class="font-medium leading-5">
        {{ t("app.updated_text", { version: version }) }}
      </p>
      <button
        class="flex items-center space-x-1 text-accent transition-colors hover:text-accentDark"
        @click="openWhatsNew"
      >
        <span>
          {{ t("app.see_whats_new") }}
        </span>
        <IconLucideArrowUpRight />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "~/composables/i18n"
import { platform } from "~/platform"

const t = useI18n()

const props = defineProps<{
  notesUrl: string
  version: string
}>()

defineEmits<{
  (e: "close-toast"): void
}>()

const openWhatsNew = () => {
  if (props.notesUrl)
    platform.kernelIO.openExternalLink({ url: props.notesUrl })
}
</script>

<style>
/* Transition Classes */
.list-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.list-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.list-leave-active {
  position: absolute;
}
</style>
