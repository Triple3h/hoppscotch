<template>
  <div
    class="flex items-center gap-2 border-b border-dividerLight bg-primary px-2 py-2"
  >
    <div class="relative flex min-w-0 flex-1 items-center">
      <icon-lucide-search
        class="svg-icons pointer-events-none absolute left-2 text-secondaryLight"
      />
      <input
        :value="modelValue"
        type="search"
        autocomplete="off"
        class="w-full rounded border border-transparent bg-primaryLight py-1.5 pl-8 pr-2 text-body text-secondaryDark placeholder-secondaryLight transition focus:border-dividerDark focus:outline-none"
        :placeholder="placeholder ?? t('action.search')"
        @input="onInput"
      />
    </div>
    <div v-if="$slots.actions" class="flex flex-none items-center">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"

defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
}>()

const t = useI18n()

const onInput = (event: Event) => {
  emit("update:modelValue", (event.target as HTMLInputElement).value)
}
</script>
