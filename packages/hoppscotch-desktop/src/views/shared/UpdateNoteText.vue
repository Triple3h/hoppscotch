<template>
  <template v-for="(span, index) in spans" :key="index">
    <strong
      v-if="span.kind === 'strong'"
      class="text-secondaryDark font-semibold"
      >{{ span.text }}</strong
    >
    <code
      v-else-if="span.kind === 'code'"
      class="bg-primaryDark rounded px-1 py-0.5 font-mono text-[0.85em]"
      >{{ span.text }}</code
    >
    <button
      v-else-if="span.kind === 'link'"
      type="button"
      class="text-accent cursor-pointer hover:underline"
      @click="openLink(span.href)"
    >
      {{ span.text }}
    </button>
    <em v-else-if="span.kind === 'emphasis'">{{ span.text }}</em>
    <span v-else>{{ span.text }}</span>
  </template>
</template>

<script setup lang="ts">
import { Io } from "~/kernel"
import type { UpdateNoteSpan } from "~/utils/update-notes"

defineProps<{ spans: UpdateNoteSpan[] }>()

// Notes are rendered by the launcher, which has no browser: a link opens in
// the user's default browser instead of navigating the window away.
const openLink = (href: string) => {
  Io.openExternalLink({ url: href }).catch((error) => {
    console.error("Failed to open update note link:", error)
  })
}
</script>
