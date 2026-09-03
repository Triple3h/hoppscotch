<template>
  <div>
    <header
      ref="headerRef"
      data-tauri-drag-region
      class="grid grid-cols-5 grid-rows-1 gap-2 overflow-x-auto overflow-y-hidden p-2"
    >
      <div
        data-tauri-drag-region
        class="col-span-2 flex items-center justify-between space-x-2"
        :style="{
          paddingTop: platform.ui?.appHeader?.paddingTop?.value,
          paddingLeft: platform.ui?.appHeader?.paddingLeft?.value,
        }"
      >
        <div class="flex">
          <!-- Unified Switcher (orgs + instances in one dropdown) -->
          <tippy
            v-if="
              platform.organization?.customOrganizationSwitcherComponent ||
              platform.instance?.instanceSwitchingEnabled
            "
            interactive
            trigger="click"
            theme="popover"
            :on-shown="() => switcherRef?.focus()"
            :on-create="onSwitcherCreate"
          >
            <HoppButtonSecondary
              class="!font-bold uppercase tracking-wide !text-secondaryDark hover:bg-primaryDark focus-visible:bg-primaryDark"
              :label="t('app.name')"
              :icon="IconChevronDown"
              reverse
            />
            <template #content="{ hide }">
              <div
                ref="switcherRef"
                class="flex flex-col focus:outline-none min-w-72"
                tabindex="0"
                @keyup.escape="hide()"
              >
                <component
                  :is="
                    platform.organization?.customOrganizationSwitcherComponent
                  "
                  v-if="
                    platform.organization?.customOrganizationSwitcherComponent
                  "
                  @close-dropdown="hide()"
                />
                <InstanceSwitcher
                  v-if="platform.instance?.instanceSwitchingEnabled"
                  @close-dropdown="hide()"
                />
              </div>
            </template>
          </tippy>

          <HoppButtonSecondary
            v-else
            class="!font-bold uppercase tracking-wide !text-secondaryDark hover:bg-primaryDark focus-visible:bg-primaryDark"
            :label="t('app.name')"
            to="/"
          />
        </div>
      </div>
      <div
        data-tauri-drag-region
        class="col-span-1 flex items-center justify-between space-x-2"
      >
        <AppSpotlightSearch />
      </div>
      <div
        data-tauri-drag-region
        class="col-span-2 flex items-center justify-between space-x-2"
      >
        <div class="flex">
          <tippy
            v-if="
              kernelMode === 'web' &&
              downloadableLinks &&
              downloadableLinks.length > 0
            "
            interactive
            trigger="click"
            theme="popover"
            :on-shown="() => downloadableLinksRef.focus()"
          >
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :title="t('app.downloads')"
              :icon="IconDownload"
              class="rounded hover:bg-primaryDark focus-visible:bg-primaryDark"
            />
            <template #content="{ hide }">
              <div
                ref="downloadableLinksRef"
                class="flex flex-col focus:outline-none"
                tabindex="0"
                @keyup.escape="hide()"
              >
                <template v-for="link in downloadableLinks" :key="link.id">
                  <HoppButtonSecondary
                    v-if="link.show ?? true"
                    :icon="link.icon"
                    :label="link.text(t)"
                    :blank="true"
                    class="rounded hover:bg-primaryDark focus-visible:bg-primaryDark justify-between"
                    :to="
                      link.action.type === 'link' ? link.action.href : undefined
                    "
                    @click="
                      link.action.type === 'custom' ? link.action.do() : null
                    "
                  />
                </template>
              </div>
            </template>
          </tippy>

          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip', allowHTML: true }"
            :title="`${
              mdAndLarger ? t('support.title') : t('app.options')
            } <kbd>?</kbd>`"
            :icon="IconLifeBuoy"
            class="rounded hover:bg-primaryDark focus-visible:bg-primaryDark"
            @click="invokeAction('modals.support.toggle')"
          />
        </div>
        <div class="flex items-center space-x-2">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('workspace.change')"
            :label="mdAndLarger ? workspaceName : ``"
            :icon="IconUser"
            class="!focus-visible:text-blue-600 !hover:text-blue-600 h-8 rounded border border-blue-600/25 bg-blue-500/10 pr-8 !text-blue-500 hover:border-blue-600/20 hover:bg-blue-600/20 focus-visible:border-blue-600/20 focus-visible:bg-blue-600/20"
          />
        </div>
      </div>
    </header>
    <AppBanner
      v-if="bannerContent"
      :banner="bannerContent"
      @dismiss="dismissBanner"
    />
  </div>
</template>

<script setup lang="ts">
import { getKernelMode } from "@hoppscotch/kernel"

import { useI18n } from "@composables/i18n"
import { invokeAction } from "@helpers/actions"
import { breakpointsTailwind, useBreakpoints, useNetwork } from "@vueuse/core"
import { useService } from "dioc/vue"
import type { Instance } from "tippy.js"
import { computed, reactive, ref, watch } from "vue"

import { platform } from "~/platform"
import { AdditionalLinksService } from "~/services/additionalLinks.service"
import {
  BANNER_PRIORITY_LOW,
  BannerContent,
  BannerService,
} from "~/services/banner.service"
import IconChevronDown from "~icons/lucide/chevron-down"
import IconDownload from "~icons/lucide/download"
import IconLifeBuoy from "~icons/lucide/life-buoy"
import IconUser from "~icons/lucide/user"

const t = useI18n()
const kernelMode = getKernelMode()

const headerRef = ref<HTMLElement | null>(null)
const downloadableLinksRef =
  kernelMode === "web" ? ref<any | null>(null) : ref(null)
const switcherRef = ref<HTMLElement | null>(null)

// Reserve scrollbar gutter so content width doesn't shift when the list
// grows long enough to scroll inside the popover's `max-h-[45vh]` container.
const onSwitcherCreate = (instance: Instance) => {
  const content = instance.popper?.querySelector(".tippy-content")
  if (content instanceof HTMLElement) {
    content.style.scrollbarGutter = "stable"
  }
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const mdAndLarger = breakpoints.greater("md")

const banner = useService(BannerService)
const bannerContent = computed(() => banner.content.value?.content)
let offlineBannerID: number | null = null

const offlineBanner: BannerContent = {
  type: "warning",
  text: (t) => t("helpers.offline"),
  alternateText: (t) => t("helpers.offline_short"),
  score: BANNER_PRIORITY_LOW,
  dismissible: true,
}

const additionalLinks = useService(AdditionalLinksService)

platform.additionalLinks?.forEach((linkSet) => {
  useService(linkSet)
})

const downloadableLinks = computed(() => {
  if (kernelMode !== "web") return null

  const headerDownloadableLink = additionalLinks?.getLinkSet(
    "HEADER_DOWNLOADABLE_LINKS"
  )

  if (!headerDownloadableLink) return null

  return headerDownloadableLink.getLinks().value
})

// Show the offline banner if the app is offline
const network = reactive(useNetwork())
const isOnline = computed(() => network.isOnline)

watch(isOnline, () => {
  if (!isOnline.value) {
    offlineBannerID = banner.showBanner(offlineBanner)
    return
  }
  if (banner.content && offlineBannerID) {
    banner.removeBanner(offlineBannerID)
  }
})

const dismissBanner = () => {
  if (banner.content.value) {
    banner.removeBanner(banner.content.value.id)
  } else if (offlineBannerID) {
    banner.removeBanner(offlineBannerID)
    offlineBannerID = null
  }
}

const workspaceName = computed(() => t("workspace.personal"))
</script>
