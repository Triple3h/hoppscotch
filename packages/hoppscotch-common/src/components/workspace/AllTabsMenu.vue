<template>
  <tippy
    interactive
    trigger="click"
    theme="popover"
    :offset="[0, 10]"
    :on-shown="onShown"
    :on-hidden="onHidden"
  >
    <!-- Same trigger box as EnvironmentsSelector (h-9 inside an h-12 rail) so
         popper distance from the tab bar matches that bubble exactly. -->
    <button
      type="button"
      class="flex h-9 min-w-7 items-center justify-center rounded px-1.5 text-secondary transition hover:bg-primary hover:text-secondaryDark focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      :aria-label="t('tab.all_tabs')"
      :aria-expanded="open"
      aria-haspopup="listbox"
    >
      <icon-lucide-list-collapse
        class="svg-icons !h-4 !w-4"
        aria-hidden="true"
      />
    </button>
    <template #content="{ hide }">
      <div
        role="dialog"
        :aria-label="t('tab.all_tabs')"
        class="w-80 max-w-[min(20rem,calc(100vw-2rem))] focus:outline-none"
        @keyup.escape="hide()"
      >
        <!-- Sticky within tippy-content's scroll box -->
        <div class="sticky top-0 z-10 -mx-2 -mt-2 bg-popover px-2 pt-2 pb-2">
          <div class="relative flex items-center">
            <icon-lucide-search
              class="svg-icons pointer-events-none absolute left-2 text-secondaryLight"
            />
            <input
              ref="searchInput"
              v-model="filterText"
              type="text"
              class="w-full rounded border border-transparent bg-primaryLight py-1.5 pl-8 pr-2 text-body text-secondaryDark placeholder-secondaryLight transition focus:border-dividerDark focus:outline-none"
              :aria-label="t('action.search')"
              :placeholder="t('action.search')"
              @keydown.down.prevent="moveActive(1)"
              @keydown.up.prevent="moveActive(-1)"
              @keydown.enter.prevent="confirmActive(hide)"
            />
          </div>
        </div>

        <div
          role="listbox"
          :aria-label="t('tab.all_tabs')"
          class="flex flex-col"
        >
          <!--
            Rows are divs, not buttons: global `button { truncate }` (nowrap +
            overflow hidden) collapses multi-line rows under the popover's
            height cap and makes labels stack. Keep each row shrink-0.
          -->
          <template v-for="group in groupedEntries" :key="group.key">
            <div
              class="flex shrink-0 items-center gap-2 px-1 pt-2.5 pb-1 text-tiny font-semibold uppercase tracking-wide text-secondaryLight"
              role="presentation"
            >
              <span>{{ group.label }}</span>
              <span class="h-px flex-1 bg-dividerLight" aria-hidden="true" />
              <span class="font-normal tabular-nums opacity-70">
                {{ group.entries.length }}
              </span>
            </div>

            <div class="flex flex-col divide-y divide-dividerLight">
              <div
                v-for="entry in group.entries"
                :key="entry.id"
                role="option"
                :aria-selected="entry.id === activeId"
                class="group flex w-full shrink-0 cursor-pointer items-center gap-2 px-1 py-1.5 transition hover:bg-primaryLight focus:bg-primaryLight focus:outline-none"
                :class="{
                  'bg-primaryLight':
                    entry.id === activeId ||
                    flatIndexById.get(entry.id) === activeIndex,
                }"
                tabindex="-1"
                @mouseenter="activeIndex = flatIndexById.get(entry.id) ?? 0"
                @focus="activeIndex = flatIndexById.get(entry.id) ?? 0"
                @click="
                  () => {
                    emit('select', entry.id)
                    hide()
                  }
                "
              >
                <span
                  v-if="entry.method"
                  class="w-10 shrink-0 truncate text-tiny font-semibold leading-tight"
                  :style="{ color: getMethodLabelColorClassOf(entry.method) }"
                >
                  {{ entry.method }}
                </span>
                <component
                  :is="kindIcon(entry.kind)"
                  v-else
                  class="svg-icons h-4 w-4 shrink-0"
                  :class="kindIconClass(entry.kind)"
                  aria-hidden="true"
                />

                <div class="min-w-0 flex-1 overflow-hidden leading-tight">
                  <div class="truncate text-body text-secondaryDark">
                    {{ entry.name }}
                  </div>
                  <div
                    v-if="entry.detail"
                    class="truncate text-tiny text-secondaryLight"
                  >
                    {{ entry.detail }}
                  </div>
                </div>

                <span
                  v-if="entry.isDirty"
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-secondaryDark group-hover:hidden"
                  aria-hidden="true"
                />

                <button
                  v-if="removable"
                  type="button"
                  class="hidden shrink-0 items-center justify-center rounded p-0.5 text-secondaryLight transition hover:text-secondaryDark group-hover:flex"
                  :aria-label="t('tab.close')"
                  :title="t('tab.close')"
                  @click.stop="emit('close', entry.id)"
                >
                  <icon-lucide-x
                    class="svg-icons !h-3.5 !w-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </template>

          <p
            v-if="flatEntries.length === 0"
            class="shrink-0 px-2 py-3 text-center text-tiny text-secondaryLight"
          >
            {{ t("error.no_results_found") }}
          </p>
        </div>
      </div>
    </template>
  </tippy>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { getMethodLabelColorClassOf } from "~/helpers/rest/labelColoring"
import IconGraphql from "~icons/hopp/graphql"
import IconFolder from "~icons/lucide/folder"
import IconLayers from "~icons/lucide/layers"
import IconListCollapse from "~icons/lucide/list-collapse"
import IconPlayCircle from "~icons/lucide/play-circle"

export type WorkspaceTabMenuKind =
  | "request"
  | "gql"
  | "example"
  | "gql-example"
  | "collection"
  | "environment"
  | "test-runner"
  | "other"

export type WorkspaceTabMenuEntry = {
  id: string
  name: string
  /** HTTP method for REST request tabs; omit for non-request kinds */
  method?: string | null
  /** Secondary line (endpoint, path, …) used for display and search */
  detail?: string | null
  kind: WorkspaceTabMenuKind
  isDirty?: boolean
}

type MenuGroupKey =
  "requests" | "environments" | "folders" | "test_runner" | "other"

const GROUP_ORDER: readonly MenuGroupKey[] = [
  "requests",
  "environments",
  "folders",
  "test_runner",
  "other",
]

const props = defineProps<{
  entries: readonly WorkspaceTabMenuEntry[]
  activeId: string
  /** Whether entries may be closed from this menu (false when only one tab) */
  removable: boolean
}>()

const emit = defineEmits<{
  (e: "select", id: string): void
  (e: "close", id: string): void
}>()

const t = useI18n()

const open = ref(false)
const filterText = ref("")
const activeIndex = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

const groupKeyOf = (kind: WorkspaceTabMenuKind): MenuGroupKey => {
  switch (kind) {
    case "request":
    case "gql":
    case "example":
    case "gql-example":
      return "requests"
    case "environment":
      return "environments"
    case "collection":
      return "folders"
    case "test-runner":
      return "test_runner"
    default:
      return "other"
  }
}

const groupLabelOf = (key: MenuGroupKey): string => {
  switch (key) {
    case "requests":
      return t("tab.group_requests")
    case "environments":
      return t("tab.group_environments")
    case "folders":
      return t("tab.group_folders")
    case "test_runner":
      return t("tab.group_test_runner")
    default:
      return t("tab.group_other")
  }
}

const matchesQuery = (entry: WorkspaceTabMenuEntry, query: string) => {
  if (!query) return true
  const haystack = [
    entry.name,
    entry.method ?? "",
    entry.detail ?? "",
    entry.kind,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

const filteredEntries = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  return props.entries.filter((entry) => matchesQuery(entry, query))
})

/** Keep tab order inside each bucket; only emit non-empty groups. */
const groupedEntries = computed(() => {
  const buckets = new Map<MenuGroupKey, WorkspaceTabMenuEntry[]>()
  for (const key of GROUP_ORDER) buckets.set(key, [])

  for (const entry of filteredEntries.value) {
    buckets.get(groupKeyOf(entry.kind))!.push(entry)
  }

  return GROUP_ORDER.map((key) => ({
    key,
    label: groupLabelOf(key),
    entries: buckets.get(key)!,
  })).filter((group) => group.entries.length > 0)
})

/** Display order used for ↑/↓ navigation (flattened groups). */
const flatEntries = computed(() =>
  groupedEntries.value.flatMap((group) => group.entries)
)

const flatIndexById = computed(() => {
  const map = new Map<string, number>()
  flatEntries.value.forEach((entry, index) => map.set(entry.id, index))
  return map
})

// Keep the keyboard cursor inside the list as search narrows it.
watch(flatEntries, (list) => {
  if (activeIndex.value >= list.length) {
    activeIndex.value = Math.max(0, list.length - 1)
  }
})

const kindIcon = (kind: WorkspaceTabMenuKind) => {
  switch (kind) {
    case "gql":
    case "gql-example":
      return IconGraphql
    case "collection":
      return IconFolder
    case "environment":
      return IconLayers
    case "test-runner":
      return IconPlayCircle
    default:
      return IconListCollapse
  }
}

const kindIconClass = (kind: WorkspaceTabMenuKind) => {
  if (kind === "gql" || kind === "gql-example") return "text-accent"
  return "text-secondaryLight"
}

const onShown = () => {
  open.value = true
  filterText.value = ""
  nextTick(() => {
    activeIndex.value = Math.max(
      0,
      flatIndexById.value.get(props.activeId) ?? 0
    )
    searchInput.value?.focus()
  })
}

const onHidden = () => {
  open.value = false
}

const moveActive = (delta: number) => {
  const len = flatEntries.value.length
  if (len === 0) return
  activeIndex.value = (activeIndex.value + delta + len) % len
}

const confirmActive = (hide: () => void) => {
  const entry = flatEntries.value[activeIndex.value]
  if (!entry) return
  emit("select", entry.id)
  hide()
}
</script>
