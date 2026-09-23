<template>
  <div
    class="flex flex-shrink-0 items-center gap-2 border-b border-dividerLight bg-primary px-4 py-2"
  >
    <!-- Left: type badge | breadcrumb path + name -->
    <div
      class="flex flex-shrink-0 items-center gap-1.5 border-r border-dividerLight pr-3 mr-1 text-xs font-medium tracking-wide"
    >
      <slot name="badge-icon" />
      <span class="font-semibold" :class="badgeClass">
        <slot name="badge" />
      </span>
    </div>

    <div class="flex min-w-0 flex-1 items-center">
      <template v-if="path.length > 0">
        <template v-for="(segment, i) in path" :key="i">
          <span
            v-tippy="{ theme: 'tooltip' }"
            :title="segment.tooltip"
            class="max-w-[10rem] flex-shrink-0 cursor-default truncate text-xs text-secondaryLight"
          >
            {{ segment.name }}
          </span>
          <component
            :is="IconChevronRight"
            class="mx-0.5 h-3.5 w-3.5 flex-shrink-0 text-secondaryLight opacity-50"
          />
        </template>
      </template>
      <HoppSmartInput
        v-model="name"
        :autofocus="false"
        styles=""
        input-styles="border border-transparent bg-transparent text-xs text-secondaryDark focus:border-divider focus:bg-primaryLight rounded px-2 py-0.5 outline-none transition-colors disabled:opacity-60"
        :placeholder="placeholder"
        :disabled="disabled"
        @submit="emit('save')"
      />
    </div>

    <!-- Right: optional extras (slot) + Save — always top-right -->
    <div class="flex flex-shrink-0 items-center gap-1.5">
      <slot name="actions" />

      <span class="flex rounded border border-divider transition">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip', delay: [500, 20], allowHTML: true }"
          :title="`${t('action.save')} <kbd>${getSpecialKey()}</kbd><kbd>S</kbd>`"
          :label="t('action.save')"
          filled
          :icon="IconSave"
          class="flex-1 rounded rounded-r-none"
          @click="emit('save')"
        />
        <!-- Optional Save As menu (request tabs) -->
        <tippy
          v-if="showSaveMenu"
          interactive
          trigger="click"
          theme="popover"
          placement="bottom-end"
        >
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('app.options')"
            :icon="IconChevronDown"
            filled
            class="rounded rounded-l-none"
          />
          <template #content="{ hide }">
            <div
              class="flex flex-col focus:outline-none"
              tabindex="0"
              @keyup.escape="hide()"
            >
              <slot name="save-menu" :hide="hide" />
            </div>
          </template>
        </tippy>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { getPlatformSpecialKey as getSpecialKey } from "~/helpers/platformutils"
import IconChevronRight from "~icons/lucide/chevron-right"
import IconChevronDown from "~icons/lucide/chevron-down"
import IconSave from "~icons/lucide/save"

export type TabPathSegment = { name: string; tooltip: string }

withDefaults(
  defineProps<{
    placeholder?: string
    disabled?: boolean
    /** Tailwind classes for the badge label (color) */
    badgeClass?: string
    /** Parent path segments shown before the name (with chevrons) */
    path?: TabPathSegment[]
    /** Request: show Save As chevron next to Save */
    showSaveMenu?: boolean
  }>(),
  {
    placeholder: "",
    disabled: false,
    badgeClass: "text-secondary",
    path: () => [],
    showSaveMenu: false,
  }
)

const emit = defineEmits<{
  (e: "save"): void
}>()

const t = useI18n()
const name = defineModel<string>({ required: true })
</script>
