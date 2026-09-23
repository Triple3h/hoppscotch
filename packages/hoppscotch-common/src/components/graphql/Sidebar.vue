<template>
  <HoppSmartTabs
    v-model="selectedNavigationTab"
    styles="sticky overflow-x-auto flex-shrink-0 bg-primary z-10 top-0"
    vertical
    render-inactive-tabs
  >
    <HoppSmartTab
      :id="'docs'"
      :icon="IconBookOpen"
      :label="`${t('tab.documentation')}`"
    >
      <GqlDocExplorer />
    </HoppSmartTab>
    <HoppSmartTab :id="'schema'" :icon="IconBox" :label="`${t('tab.schema')}`">
      <GqlSchema />
    </HoppSmartTab>

    <HoppSmartTab
      :id="'collections'"
      :icon="IconFolder"
      :label="`${t('tab.collections')}`"
    >
      <CollectionsGraphql />
    </HoppSmartTab>
    <HoppSmartTab
      :id="'history'"
      :icon="IconClock"
      :label="`${t('tab.history')}`"
    >
      <History :page="'graphql'" />
    </HoppSmartTab>
  </HoppSmartTabs>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { useI18n } from "@composables/i18n"
import IconBookOpen from "~icons/lucide/book-open"
import IconBox from "~icons/lucide/box"
import IconClock from "~icons/lucide/clock"
import IconFolder from "~icons/lucide/folder"

type NavigationTabs = "history" | "collection" | "docs" | "schema"

const selectedNavigationTab = ref<NavigationTabs>("docs")

const t = useI18n()
</script>
