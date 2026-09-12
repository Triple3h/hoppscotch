<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- View mode switch: raw events timeline / assembled messages -->
    <div class="flex-shrink-0">
      <HoppSmartTabs
        v-model="viewMode"
        styles="sticky top-lowerSecondaryStickyFold z-10 bg-primary"
        render-inactive-tabs
      >
        <template #actions>
          <div class="flex items-center gap-1 px-2">
            <tippy
              v-if="viewMode === 'merged'"
              interactive
              trigger="click"
              theme="popover"
              :on-shown="() => presetTippy?.focus()"
            >
              <HoppSmartSelectWrapper>
                <button
                  v-tippy="{ theme: 'tooltip' }"
                  :title="t('response.sse.message_format')"
                  class="flex items-center gap-1.5 rounded bg-primaryLight px-3 py-1 text-tiny font-bold text-secondaryDark transition hover:bg-primaryDark"
                >
                  {{ currentPresetLabel }}
                  <icon-lucide-chevron-down
                    class="svg-icons text-secondaryLight"
                  />
                </button>
              </HoppSmartSelectWrapper>
              <template #content="{ hide }">
                <div
                  ref="presetTippy"
                  class="flex flex-col focus:outline-none"
                  tabindex="0"
                  @keyup.escape="hide()"
                >
                  <HoppSmartItem
                    v-for="preset in MESSAGE_FORMAT_PRESETS"
                    :key="preset"
                    :label="presetLabel(preset)"
                    :active="formatPref.preset === preset"
                    :info-icon="
                      formatPref.preset === preset ? IconCheck : undefined
                    "
                    :active-info-icon="formatPref.preset === preset"
                    @click="
                      () => {
                        setSSEMessageFormatPreset(preset)
                        hide()
                      }
                    "
                  />
                </div>
              </template>
            </tippy>

            <HoppButtonSecondary
              v-if="viewMode === 'merged'"
              v-tippy="{ theme: 'tooltip' }"
              :title="t('response.sse.reasoning')"
              :icon="IconBrain"
              :class="{ '!text-accent': formatPref.showReasoning }"
              @click="setSSEReasoningVisible(!formatPref.showReasoning)"
            />

            <HoppButtonSecondary
              v-if="viewMode === 'events'"
              v-tippy="{ theme: 'tooltip' }"
              :title="t('response.sse.filter_events')"
              :icon="IconFilter"
              :class="{ '!text-accent': filterOpen }"
              @click="filterOpen = !filterOpen"
            />

            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :title="
                viewMode === 'merged'
                  ? t('response.sse.copy_merged')
                  : t('response.sse.copy_event')
              "
              :icon="IconCopy"
              :disabled="
                viewMode === 'merged'
                  ? !assembled.content && !assembled.reasoning
                  : !selectedEvent
              "
              @click="copyCurrent"
            />
          </div>
        </template>

        <HoppSmartTab
          id="events"
          :label="t('response.sse.events_view')"
          :info="events.length > 0 ? String(events.length) : null"
        />
        <HoppSmartTab id="merged" :label="t('response.sse.merged_view')" />
      </HoppSmartTabs>
    </div>

    <!-- Filter row (events mode) -->
    <div
      v-if="viewMode === 'events' && filterOpen"
      class="flex flex-shrink-0 overflow-x-auto border-b border-dividerLight bg-primary"
    >
      <div
        class="inline-flex flex-1 items-center border-divider bg-primaryLight text-secondaryDark"
      >
        <span class="inline-flex flex-1 items-center px-4">
          <icon-lucide-search class="h-4 w-4 text-secondaryLight" />
          <input
            v-model="filterQuery"
            v-focus
            class="input !border-0 !px-2"
            :placeholder="t('response.sse.filter_events')"
            type="text"
          />
        </span>
      </div>
    </div>

    <!-- Custom JSON path inputs (merged mode) -->
    <div
      v-if="viewMode === 'merged' && formatPref.preset === 'custom'"
      class="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-dividerLight bg-primary px-4 py-2"
    >
      <input
        :value="formatPref.customPaths.content"
        class="input flex-1 !py-1 text-tiny"
        :placeholder="`${t('response.sse.content_path')} · ${t('response.sse.custom_paths_hint')}`"
        spellcheck="false"
        @input="
          setCustomPath('content', ($event.target as HTMLInputElement).value)
        "
      />
      <input
        :value="formatPref.customPaths.reasoning"
        class="input flex-1 !py-1 text-tiny"
        :placeholder="t('response.sse.reasoning_path')"
        spellcheck="false"
        @input="
          setCustomPath('reasoning', ($event.target as HTMLInputElement).value)
        "
      />
    </div>

    <!-- Events view -->
    <div
      v-if="viewMode === 'events'"
      ref="listRef"
      class="flex min-h-0 flex-1 flex-col divide-y divide-dividerLight overflow-auto [scrollbar-gutter:stable]"
      @scroll="onListScroll"
    >
      <div
        v-if="filteredEvents.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-secondaryLight"
      >
        <icon-lucide-inbox class="svg-icons opacity-40" />
        <span class="text-tiny">{{ t("response.sse.no_events") }}</span>
      </div>

      <button
        v-for="event in filteredEvents"
        :key="event.index"
        class="flex w-full items-center gap-2 px-4 py-1.5 text-left transition hover:bg-primaryLight"
        :class="{ 'bg-primaryLight': selectedEvent?.index === event.index }"
        @click="selectEvent(event)"
      >
        <span
          class="w-10 flex-shrink-0 font-mono text-tiny text-secondaryLight"
        >
          #{{ event.index }}
        </span>
        <span
          v-if="event.event !== 'message'"
          class="flex-shrink-0 rounded border border-dividerLight px-1.5 py-0.5 font-mono text-tiny text-secondaryLight"
        >
          {{ event.event }}
        </span>
        <span
          v-if="event.isTerminal"
          v-tippy="{ theme: 'tooltip' }"
          class="flex-shrink-0 rounded border border-dividerLight px-1.5 py-0.5 font-mono text-tiny text-secondaryLight"
          :title="t('response.sse.terminal')"
        >
          [DONE]
        </span>
        <span class="flex-1 truncate font-mono text-tiny text-secondaryDark">
          {{ event.data }}
        </span>
        <span class="flex-shrink-0 font-mono text-tiny text-secondaryLight">
          {{ formatTime(event.time) }}
        </span>
      </button>
    </div>

    <!-- Merged view -->
    <div
      v-else
      ref="mergedRef"
      class="min-h-0 flex-1 overflow-auto"
      @scroll="onMergedScroll"
    >
      <div class="flex flex-col gap-4 p-4">
        <div
          v-if="formatPref.showReasoning && assembled.reasoning"
          class="overflow-hidden rounded border border-dividerLight bg-primaryLight"
        >
          <button
            class="flex w-full items-center justify-between gap-2 px-3 py-1.5 transition hover:bg-primaryDark"
            @click="reasoningCollapsed = !reasoningCollapsed"
          >
            <span
              class="flex items-center gap-1.5 text-tiny font-semibold text-secondaryLight"
            >
              <icon-lucide-brain class="svg-icons" />
              {{ t("response.sse.reasoning") }}
            </span>
            <icon-lucide-chevron-down
              class="svg-icons transform text-secondaryLight transition"
              :class="{ 'rotate-180': !reasoningCollapsed }"
            />
          </button>
          <div
            v-if="!reasoningCollapsed"
            class="border-t border-dividerLight px-3 py-2"
          >
            <pre
              class="whitespace-pre-wrap break-words font-mono text-body text-secondary"
              >{{ assembled.reasoning }}</pre>
          </div>
        </div>

        <pre
          v-if="assembled.content"
          class="whitespace-pre-wrap break-words font-mono text-body text-secondaryDark"
          >{{ assembled.content }}</pre>

        <div
          v-if="!assembled.content && !assembled.reasoning"
          class="text-tiny text-secondaryLight"
        >
          {{ t("response.sse.no_events") }}
        </div>
      </div>
    </div>

    <!-- Stream status -->
    <div
      v-if="isStreaming"
      class="flex flex-shrink-0 items-center gap-1.5 border-t border-dividerLight bg-primary px-4 py-1 text-tiny text-accent"
    >
      <icon-lucide-loader-2 class="svg-icons animate-spin" />
      {{ t("response.sse.receiving") }}
    </div>

    <!-- Event detail panel (events mode) -->
    <div
      v-if="viewMode === 'events' && selectedEvent"
      class="flex min-h-0 flex-[1.5] flex-col border-t border-dividerLight"
    >
      <div
        class="flex flex-shrink-0 items-center justify-between border-b border-dividerLight bg-primary pl-4"
      >
        <label class="truncate text-tiny font-semibold text-secondaryLight">
          #{{ selectedEvent.index }}
          <template v-if="selectedEvent.event !== 'message'">
            · {{ selectedEvent.event }}</template
          >
          <template v-if="selectedEvent.id">
            · id: {{ selectedEvent.id }}</template
          >
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
            :class="{ '!text-accent': detailWrap }"
            :icon="IconWrapText"
            @click="detailWrap = !detailWrap"
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('response.sse.copy_event')"
            :icon="IconCopy"
            @click="copyEvent"
          />
        </div>
      </div>
      <!--
        The payload gets the same CodeMirror viewer as the response body and
        the realtime log: line numbers, JSON highlighting and a fold gutter
        with `{ … } (N fields)` summaries, so a chunk can be collapsed down to
        the field being read instead of being one long unwrapped line.
      -->
      <div
        ref="detailEditor"
        class="min-h-0 min-w-0 flex-1 overflow-auto"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconBrain from "~icons/lucide/brain"
import IconCheck from "~icons/lucide/check"
import IconCopy from "~icons/lucide/copy"
import IconFilter from "~icons/lucide/filter"
import IconWrapText from "~icons/lucide/wrap-text"
import { computed, nextTick, reactive, ref, watch } from "vue"
import { useVModel } from "@vueuse/core"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { useStream } from "@composables/stream"
import {
  HoppRESTRequestResponse,
  HoppRESTResponse,
} from "~/helpers/types/HoppRESTResponse"
import { parseSSEStream, SSEEvent } from "~/helpers/sse/parser"
import {
  assembleMessages,
  MESSAGE_FORMAT_PRESETS,
  MessageFormatPreset,
} from "~/helpers/sse/format"
import {
  SSEMessageFormat$,
  setSSECustomFormatPaths,
  setSSEMessageFormatPreset,
  setSSEReasoningVisible,
} from "~/newstore/SSEMessageFormat"

const DETAIL_MODES = ["pretty", "raw"] as const
type DetailMode = (typeof DETAIL_MODES)[number]

const t = useI18n()
const toast = useToast()

const props = defineProps<{
  response: HoppRESTResponse | HoppRESTRequestResponse
  isSavable: boolean
  isEditable: boolean
  tabId: string
  isTestRunner?: boolean
}>()

const emit = defineEmits<{
  (e: "save-as-example"): void
  (e: "update:response", val: HoppRESTRequestResponse | HoppRESTResponse): void
}>()

useVModel(props, "response", emit)

const presetTippy = ref<HTMLElement | null>(null)
const filterOpen = ref(false)
const filterQuery = ref("")
const viewMode = ref<"events" | "merged">("events")
const detailMode = ref<DetailMode>("pretty")
const selectedEventIndex = ref<number | null>(null)
const reasoningCollapsed = ref(false)

const listRef = ref<HTMLElement | null>(null)
const mergedRef = ref<HTMLElement | null>(null)
const eventsAutoScroll = ref(true)
const mergedAutoScroll = ref(true)

// Global (persisted) format preference, mirrored through the store
const formatPref = useStream(
  SSEMessageFormat$,
  {
    preset: "openai" as MessageFormatPreset,
    customPaths: {},
    showReasoning: true,
  },
  (value) => {
    setSSEMessageFormatPreset(value.preset)
    setSSECustomFormatPaths(value.customPaths)
    setSSEReasoningVisible(value.showReasoning)
  }
)

const currentPresetLabel = computed(() => presetLabel(formatPref.value.preset))

function presetLabel(preset: MessageFormatPreset): string {
  switch (preset) {
    case "openai":
      return "OpenAI API"
    case "gemini":
      return "Gemini API"
    case "claude":
      return "Claude API"
    case "ollama-generate":
      return "Ollama (Generate)"
    case "ollama-chat":
      return "Ollama (Chat)"
    case "custom":
      return t("response.sse.custom")
  }
}

function setCustomPath(which: "content" | "reasoning", value: string) {
  setSSECustomFormatPaths({
    ...formatPref.value.customPaths,
    [which]: value || undefined,
  })
}

const decoder = new TextDecoder("utf-8", { fatal: false })

const sseText = computed(() => {
  const res = props.response
  if (res.type === "success" || res.type === "fail") {
    return decoder.decode(res.body)
  }
  if (res.type === "loading" && res.streaming) {
    return decoder.decode(res.streaming.body)
  }
  return ""
})

const isStreaming = computed(() => props.response.type === "loading")

const events = computed<SSEEvent[]>(() => parseSSEStream(sseText.value))

const filteredEvents = computed<SSEEvent[]>(() => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) return events.value
  return events.value.filter(
    (event) =>
      event.data.toLowerCase().includes(query) ||
      event.event.toLowerCase().includes(query)
  )
})

const selectedEvent = computed(() => {
  if (selectedEventIndex.value === null) return null
  return events.value.find((e) => e.index === selectedEventIndex.value) ?? null
})

const selectedDetail = computed(() => {
  const event = selectedEvent.value
  if (!event) return ""

  if (detailMode.value === "raw") return event.data

  try {
    return JSON.stringify(JSON.parse(event.data), null, 2)
  } catch (_e) {
    return event.data
  }
})

function selectEvent(event: SSEEvent) {
  selectedEventIndex.value = event.index
}

const detailEditor = ref<any | null>(null)
const detailWrap = ref(true)

// Only payloads that actually parse as JSON are worth highlighting and
// folding; terminal markers like `[DONE]` fall back to plain text.
const selectedIsJson = computed(() => {
  const event = selectedEvent.value
  if (!event) return false

  try {
    JSON.parse(event.data)
    return true
  } catch (_e) {
    return false
  }
})

const detailEditorMode = computed(() =>
  detailMode.value === "pretty" && selectedIsJson.value
    ? "application/ld+json"
    : "text/plain"
)

useCodemirror(
  detailEditor,
  computed(() => (selectedEvent.value ? selectedDetail.value : "")),
  reactive({
    extendedEditorConfig: {
      mode: detailEditorMode,
      readOnly: true,
      lineWrapping: detailWrap,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

const assembled = computed(() => {
  return assembleMessages(
    events.value,
    formatPref.value.preset,
    formatPref.value.customPaths
  )
})

function formatTime(time?: number): string {
  if (!time) return ""
  return new Date(time).toLocaleTimeString("en-GB", { hour12: false })
}

// Keep the tail of the stream in view while events arrive, unless the
// user has scrolled away from the bottom
function onListScroll() {
  const el = listRef.value
  if (!el) return
  eventsAutoScroll.value =
    el.scrollTop + el.clientHeight >= el.scrollHeight - 24
}

function onMergedScroll() {
  const el = mergedRef.value
  if (!el) return
  mergedAutoScroll.value =
    el.scrollTop + el.clientHeight >= el.scrollHeight - 24
}

watch(
  () => events.value.length,
  async () => {
    await nextTick()
    if (
      viewMode.value === "events" &&
      eventsAutoScroll.value &&
      listRef.value
    ) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
    if (
      viewMode.value === "merged" &&
      mergedAutoScroll.value &&
      mergedRef.value
    ) {
      mergedRef.value.scrollTop = mergedRef.value.scrollHeight
    }
  }
)

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t("response.sse.copied"))
  } catch (_e) {
    // Clipboard unavailable (permissions etc.) — nothing to recover
  }
}

function copyCurrent() {
  if (viewMode.value === "merged") {
    copyText(assembled.value.content || assembled.value.reasoning)
    return
  }
  if (selectedEvent.value) {
    copyText(
      detailMode.value === "pretty"
        ? selectedDetail.value
        : selectedEvent.value.data
    )
    return
  }
  copyText(sseText.value)
}

function copyEvent() {
  if (selectedEvent.value) {
    copyText(selectedEvent.value.data)
  }
}
</script>
