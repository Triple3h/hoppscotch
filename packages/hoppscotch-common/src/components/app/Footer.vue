<template>
  <div>
    <div class="flex justify-between bg-primary">
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="EXPAND_NAVIGATION ? t('hide.sidebar') : t('show.sidebar')"
          :icon="IconSidebar"
          class="transform"
          :class="{ '-rotate-180': !EXPAND_NAVIGATION }"
          @click="EXPAND_NAVIGATION = !EXPAND_NAVIGATION"
        />
        <tippy interactive trigger="click" theme="popover">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('settings.interceptor')"
            :icon="IconShieldCheck"
          />
          <template #content>
            <AppKernelInterceptor />
          </template>
        </tippy>
        <HoppButtonSecondary
          v-if="platform.platformFeatureFlags.cookiesEnabled ?? false"
          :label="t('app.cookies')"
          :icon="IconCookie"
          @click="showCookiesModal = true"
        />
      </div>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip', allowHTML: true }"
          :title="`${t(
            'app.shortcuts'
          )} <kbd>${getSpecialKey()}</kbd><kbd>/</kbd>`"
          :icon="IconZap"
          @click="invokeAction('flyouts.keybinds.toggle')"
        />
        <HoppButtonSecondary
          v-if="navigatorShare"
          v-tippy="{ theme: 'tooltip' }"
          :icon="IconShare2"
          :title="t('request.share')"
          @click="nativeShare()"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="COLUMN_LAYOUT ? t('layout.row') : t('layout.column')"
          :icon="IconColumns"
          class="transform"
          :class="{ 'rotate-90': !COLUMN_LAYOUT }"
          @click="COLUMN_LAYOUT = !COLUMN_LAYOUT"
        />
        <span
          class="transform transition"
          :class="{
            'rotate-180': SIDEBAR_ON_LEFT,
          }"
        >
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="SIDEBAR ? t('hide.sidebar') : t('show.sidebar')"
            :icon="IconSidebarOpen"
            class="transform"
            :class="{ 'rotate-180': !SIDEBAR }"
            @click="SIDEBAR = !SIDEBAR"
          />
        </span>
      </div>
    </div>
    <CookiesAllModal
      :show="showCookiesModal"
      @hide-modal="showCookiesModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import IconCookie from "~icons/lucide/cookie"
import IconSidebar from "~icons/lucide/sidebar"
import IconZap from "~icons/lucide/zap"
import IconShare2 from "~icons/lucide/share-2"
import IconColumns from "~icons/lucide/columns"
import IconSidebarOpen from "~icons/lucide/sidebar-open"
import IconShieldCheck from "~icons/lucide/shield-check"
import { useSetting } from "@composables/settings"
import { useI18n } from "@composables/i18n"
import { platform } from "~/platform"
import { getPlatformSpecialKey as getSpecialKey } from "~/helpers/platformutils"
import { invokeAction } from "@helpers/actions"

const t = useI18n()

const showCookiesModal = ref(false)

const EXPAND_NAVIGATION = useSetting("EXPAND_NAVIGATION")
const SIDEBAR = useSetting("SIDEBAR")
const COLUMN_LAYOUT = useSetting("COLUMN_LAYOUT")
const SIDEBAR_ON_LEFT = useSetting("SIDEBAR_ON_LEFT")

const navigatorShare = !!navigator.share

const nativeShare = () => {
  if (navigator.share) {
    navigator
      .share({
        title: "Hoppscotch",
        text: "Hoppscotch • Open source API development ecosystem - Helps you create requests faster, saving precious time on development.",
        url: "https://hoppscotch.io",
      })
      .catch(console.error)
  } else {
    // fallback
  }
}
</script>
