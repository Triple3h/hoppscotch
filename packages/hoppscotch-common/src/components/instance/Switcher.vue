<template>
  <!--
    Personal-workspace-only fork: this dropdown shows the single local
    instance (display name, kind, shell version). Remote instance
    connect/remove/cache paths were removed as dead multi-instance code.
  -->
  <div class="flex flex-col space-y-1 w-full">
    <!-- Section header -->
    <div
      class="flex items-center justify-between border-b border-dividerLight px-4 py-2"
    >
      <span class="text-xs text-secondary">
        {{ t("instances.self_hosted") }}
      </span>
    </div>

    <div
      v-if="currentInstance"
      class="flex items-center justify-between px-4 py-3 bg-accent text-accentContrast rounded-md"
    >
      <div class="flex items-center gap-4">
        <IconLucideServer />
        <div class="flex flex-col">
          <span class="font-semibold uppercase">{{
            currentInstance.displayName
          }}</span>
          <div class="flex items-center gap-1">
            <span class="text-xs">{{ currentInstance.kind }}</span>
            <span v-if="currentInstance.version" class="text-xs">
              v{{ currentInstance.version }}
            </span>
          </div>
        </div>
      </div>
      <IconLucideCheck />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Subscription } from "rxjs"
import { onMounted, onUnmounted, ref } from "vue"

import { useI18n } from "@composables/i18n"

import { platform } from "~/platform"
import type { Instance } from "~/platform/instance"

import IconLucideCheck from "~icons/lucide/check"
import IconLucideServer from "~icons/lucide/server"

const t = useI18n()

// Header.vue binds @close-dropdown; keep the contract even though the
// remaining display has no interactive entries that trigger it.
defineEmits<{
  "close-dropdown": []
}>()

const currentInstance = ref<Instance | null>(null)

let currentInstanceSubscription: Subscription | null = null

onMounted(() => {
  currentInstance.value = platform.instance?.getCurrentInstance?.() ?? null
  currentInstanceSubscription =
    platform.instance?.getCurrentInstanceStream?.().subscribe({
      next: (instance) => {
        currentInstance.value = instance
      },
    }) ?? null
})

onUnmounted(() => {
  currentInstanceSubscription?.unsubscribe()
})
</script>
