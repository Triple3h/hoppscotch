<template>
  <div class="flex flex-col border-t border-dividerLight">
    <div
      class="flex flex-shrink-0 items-center justify-between border-b border-dividerLight bg-primaryLight pl-4"
    >
      <label class="truncate text-tiny font-semibold text-secondaryLight">
        <template v-if="event.id">id: {{ event.id }}</template>
      </label>
      <div class="flex items-center">
        <HoppButtonSecondary
          v-for="mode in DETAIL_MODES"
          :key="mode"
          v-tippy="{ theme: 'tooltip' }"
          :title="t(`response.sse.${mode}`)"
          :label="t(`response.sse.${mode}`)"
          :class="{ '!text-accent': detailMode === mode }"
          @click="detailMode = mode"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('state.linewrap')"
          :class="{ '!text-accent': wrap }"
          :icon="IconWrapText"
          @click="wrap = !wrap"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('response.sse.copy_event')"
          :icon="IconCopy"
          @click="copyPayload"
        />
      </div>
    </div>
    <!--
      The payload gets the same CodeMirror viewer as the response body and the
      realtime log: line numbers, JSON highlighting and a fold gutter with
      `{ … } (N fields)` summaries. Height follows the payload up to a cap, so
      a one-line chunk stays one line tall while a long one scrolls.
    -->
    <div
      ref="editor"
      class="max-h-80 min-w-0 overflow-auto [scrollbar-gutter:stable]"
    ></div>
  </div>
</template>

<script setup lang="ts">
import IconCopy from "~icons/lucide/copy"
import IconWrapText from "~icons/lucide/wrap-text"
import { computed, reactive, ref } from "vue"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { type SSEEvent } from "~/helpers/sse/parser"
import { copyToClipboard } from "~/helpers/utils/clipboard"

const DETAIL_MODES = ["pretty", "raw"] as const
type DetailMode = (typeof DETAIL_MODES)[number]

const props = defineProps<{ event: SSEEvent }>()

const t = useI18n()
const toast = useToast()

const detailMode = ref<DetailMode>("pretty")
const wrap = ref(true)

const payload = computed(() => {
  if (detailMode.value === "raw") return props.event.data

  try {
    return JSON.stringify(JSON.parse(props.event.data), null, 2)
  } catch (_e) {
    return props.event.data
  }
})

// Only payloads that actually parse as JSON are worth highlighting and
// folding; terminal markers like `[DONE]` fall back to plain text.
const isJson = computed(() => {
  try {
    JSON.parse(props.event.data)
    return true
  } catch (_e) {
    return false
  }
})

const editorMode = computed(() =>
  detailMode.value === "pretty" && isJson.value
    ? "application/ld+json"
    : "text/plain"
)

const editor = ref<any | null>(null)

useCodemirror(
  editor,
  payload,
  reactive({
    extendedEditorConfig: {
      mode: editorMode,
      readOnly: true,
      lineWrapping: wrap,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

const copyPayload = () => {
  copyToClipboard(payload.value)
  toast.success(t("response.sse.copied"))
}
</script>
