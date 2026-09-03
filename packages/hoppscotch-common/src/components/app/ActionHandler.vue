<template>
  <AppShortcuts :show="showShortcuts" @close="showShortcuts = false" />
  <AppShare :show="showShare" @hide-modal="showShare = false" />
  <InstanceSwitcher
    v-if="showInstanceSwitcher"
    @hide-modal="showInstanceSwitcher = false"
  />
  <HttpResponseInterface
    v-if="isDrawerOpen"
    :show="isDrawerOpen"
    @close="isDrawerOpen = false"
  />
</template>

<script setup lang="ts">
import { ref } from "vue"
import { defineActionHandler } from "~/helpers/actions"

const showShortcuts = ref(false)
const showShare = ref(false)
const showInstanceSwitcher = ref(false)
const isDrawerOpen = ref(false)

defineActionHandler("flyouts.keybinds.toggle", () => {
  showShortcuts.value = !showShortcuts.value
})

defineActionHandler("modals.share.toggle", () => {
  showShare.value = !showShare.value
})

defineActionHandler("modals.instance-switcher.toggle", () => {
  showInstanceSwitcher.value = !showInstanceSwitcher.value
})

defineActionHandler("response.schema.toggle", () => {
  isDrawerOpen.value = !isDrawerOpen.value
})
</script>
