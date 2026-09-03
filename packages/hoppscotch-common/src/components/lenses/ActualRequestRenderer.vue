<template>
  <div class="flex flex-col overflow-y-auto">
    <!-- Request URL -->
    <div class="flex flex-col border-b border-dividerLight">
      <div class="flex flex-shrink-0 items-center justify-between pl-4">
        <label class="truncate py-2 font-semibold text-secondaryLight">
          {{ t("response.request_url") }}
        </label>
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.copy')"
          :icon="urlCopyIcon"
          @click="copyUrl"
        />
      </div>
      <div class="flex items-start gap-3 px-4 pb-3">
        <span
          class="rounded bg-primaryLight px-2 py-0.5 font-mono text-xs font-semibold"
          :class="methodColor"
        >
          {{ method }}
        </span>
        <span class="min-w-0 flex-1 select-all break-all font-mono text-body">
          {{ effectiveURL }}
        </span>
      </div>
    </div>

    <!-- Final request headers (auth / inherited / user merged) -->
    <div
      v-if="finalHeaders && finalHeaders.length"
      class="flex flex-col border-b border-dividerLight"
    >
      <div class="flex flex-shrink-0 items-center justify-between pl-4">
        <label class="truncate py-2 font-semibold text-secondaryLight">
          {{ t("response.request_headers") }} ({{ finalHeaders.length }})
        </label>
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.copy')"
          :icon="headersCopyIcon"
          @click="copyHeaders"
        />
      </div>
      <LensesHeadersRendererEntry
        v-for="(header, index) in finalHeaders"
        :key="`${header.key}-${index}`"
        :header-key="header.key"
        :header-value="header.value"
        :is-editable="false"
      />
    </div>

    <!-- Final request body -->
    <div v-if="bodyText" class="flex flex-col border-b border-dividerLight">
      <div class="flex flex-shrink-0 items-center justify-between pl-4">
        <div class="flex items-center gap-2">
          <label class="truncate py-2 font-semibold text-secondaryLight">
            {{ t("response.request_body") }}
          </label>
          <span
            v-if="bodyContentType"
            class="rounded bg-primaryLight px-2 py-0.5 font-mono text-xs text-secondaryLight"
          >
            {{ bodyContentType }}
          </span>
        </div>
        <div class="flex">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('state.linewrap')"
            :class="{ '!text-accent': BODY_WRAP }"
            :icon="IconWrapText"
            @click.prevent="
              toggleNestedSetting('WRAP_LINES', 'httpResponseBody')
            "
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('action.copy')"
            :icon="bodyCopyIcon"
            @click="copyBody"
          />
        </div>
      </div>
      <div
        ref="bodyEditor"
        class="max-h-96 min-h-[4rem] overflow-auto border-t border-dividerLight"
      ></div>
    </div>

    <!-- Request code -->
    <div class="flex flex-col">
      <div class="flex flex-shrink-0 items-center justify-between pl-4">
        <div class="flex items-center gap-2">
          <label class="truncate py-2 font-semibold text-secondaryLight">
            {{ t("response.request_code") }}
          </label>
          <tippy
            interactive
            trigger="click"
            theme="popover"
            placement="bottom"
            :on-shown="() => tippyActions.focus()"
          >
            <HoppSmartSelectWrapper>
              <HoppButtonSecondary
                :label="selectedCodegen?.caption"
                outline
                class="flex-1 pr-8"
              />
            </HoppSmartSelectWrapper>
            <template #content="{ hide }">
              <div
                ref="tippyActions"
                class="flex max-h-64 flex-col overflow-y-auto focus:outline-none"
                tabindex="0"
                @keyup.escape="hide()"
              >
                <HoppSmartItem
                  v-for="codegen in CodegenDefinitions"
                  :key="codegen.name"
                  :label="codegen.caption"
                  :info-icon="
                    codegen.name === codegenType ? IconCheck : undefined
                  "
                  :active-info-icon="codegen.name === codegenType"
                  @click="
                    () => {
                      codegenType = codegen.name
                      codegenMode = codegen.lang
                      hide()
                    }
                  "
                />
              </div>
            </template>
          </tippy>
        </div>
        <div class="flex">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('state.linewrap')"
            :class="{ '!text-accent': CODE_WRAP }"
            :icon="IconWrapText"
            @click.prevent="toggleNestedSetting('WRAP_LINES', 'codeGen')"
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('action.copy')"
            :icon="codeCopyIcon"
            @click="copyCode"
          />
        </div>
      </div>
      <div
        ref="codeEditor"
        class="max-h-96 min-h-[6rem] overflow-auto border-t border-dividerLight"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue"
import { asyncComputed, refAutoReset } from "@vueuse/core"
import * as O from "fp-ts/Option"
import type { HoppRESTRequest } from "@hoppscotch/data"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import { useCopyResponse } from "~/composables/lens-actions"
import { useNestedSetting } from "~/composables/settings"
import { toggleNestedSetting } from "~/newstore/settings"
import {
  CodegenDefinitions,
  CodegenLang,
  CodegenName,
  generateCode,
} from "~/helpers/new-codegen"
import type { EffectiveHoppRESTRequest } from "~/helpers/utils/EffectiveURL"
import { isJSONContentType } from "~/helpers/utils/contenttypes"
import { copyToClipboard } from "~/helpers/utils/clipboard"
import { useToast } from "@composables/toast"
import { makeRESTRequest } from "@hoppscotch/data"
import IconCopy from "~icons/lucide/copy"
import IconCheck from "~icons/lucide/check"
import IconWrapText from "~icons/lucide/wrap-text"

const props = defineProps<{
  request: EffectiveHoppRESTRequest | HoppRESTRequest
}>()

const t = useI18n()

const isEffective = (
  req: EffectiveHoppRESTRequest | HoppRESTRequest
): req is EffectiveHoppRESTRequest =>
  "effectiveFinalURL" in req && typeof req.effectiveFinalURL === "string"

const effectiveURL = computed(() =>
  isEffective(props.request)
    ? props.request.effectiveFinalURL
    : props.request.endpoint
)

const method = computed(() => props.request.method)

const methodColor = computed(() => {
  const colors: Record<string, string> = {
    GET: "text-green-500",
    POST: "text-amber-500",
    PUT: "text-blue-500",
    PATCH: "text-teal-500",
    DELETE: "text-red-500",
    HEAD: "text-lime-500",
    OPTIONS: "text-secondary",
  }
  return colors[method.value] ?? "text-secondary"
})

const finalHeaders = computed(() => {
  if (isEffective(props.request) && props.request.effectiveFinalHeaders?.length)
    return props.request.effectiveFinalHeaders
  return props.request.headers.filter((h) => h.active && h.key !== "")
})

const bodyContentType = computed(() => {
  const contentType = finalHeaders.value.find(
    (h) => h.key.toLowerCase() === "content-type"
  )?.value
  return contentType ?? ""
})

const prettyPrintIfJSON = (raw: string) => {
  if (!isJSONContentType(bodyContentType.value)) return raw
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const bodyText = computed(() => {
  if (!isEffective(props.request)) return null

  const body = props.request.effectiveFinalBody

  if (body === null || body === "") return null

  if (typeof body === "string") return prettyPrintIfJSON(body)

  if (body instanceof FormData) {
    const lines: string[] = []
    body.forEach((value, key) => {
      lines.push(
        `${key}: ${
          value instanceof File ? `[file] ${value.name}` : String(value)
        }`
      )
    })
    return lines.join("\n")
  }

  if (body instanceof Blob) {
    return `[binary] ${body.type || "unknown type"}, ${body.size} bytes`
  }

  return String(body)
})

const bodyMode = computed(() => {
  const contentType = bodyContentType.value
  if (isJSONContentType(contentType)) return "application/ld+json"
  if (contentType.includes("html")) return "text/html"
  if (contentType.includes("xml")) return "application/xml"
  return "text/plain"
})

const BODY_WRAP = useNestedSetting("WRAP_LINES", "httpResponseBody")
const CODE_WRAP = useNestedSetting("WRAP_LINES", "codeGen")

const bodyEditor = ref<any | null>(null)
useCodemirror(
  bodyEditor,
  computed(() => bodyText.value ?? ""),
  reactive({
    extendedEditorConfig: {
      mode: bodyMode,
      readOnly: true,
      lineWrapping: BODY_WRAP,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

/**
 * Builds a HoppRESTRequest from the actually-sent request so the standard
 * code generators can consume it (URL, headers and params are the effective,
 * fully resolved ones).
 */
const codegenRequest = computed((): HoppRESTRequest | null => {
  const req = props.request
  try {
    const effectiveBody = isEffective(req) ? req.effectiveFinalBody : null
    const body =
      typeof effectiveBody === "string"
        ? { ...req.body, body: effectiveBody }
        : req.body

    const headers =
      isEffective(req) && req.effectiveFinalHeaders?.length
        ? req.effectiveFinalHeaders
        : req.headers.filter((h) => h.active && h.key !== "")

    const params =
      isEffective(req) && req.effectiveFinalParams?.length
        ? req.effectiveFinalParams
        : req.params.filter((p) => p.active && p.key !== "")

    return makeRESTRequest({
      ...req,
      endpoint: effectiveURL.value,
      headers: headers.map((h) => ({ ...h, active: true })),
      params: params.map((p) => ({ ...p, active: true })),
      body,
    })
  } catch {
    return null
  }
})

const codegenType = ref<CodegenName>("shell-curl")
const codegenMode = ref<CodegenLang>("shell")

const selectedCodegen = computed(() =>
  CodegenDefinitions.find((x) => x.name === codegenType.value)
)

const requestCode = asyncComputed(async (): Promise<string> => {
  const request = codegenRequest.value
  if (!request) return ""
  try {
    const result = generateCode(codegenType.value, request)
    return O.isSome(result) ? result.value : ""
  } catch {
    return ""
  }
})

const codeEditor = ref<any | null>(null)
useCodemirror(
  codeEditor,
  requestCode,
  reactive({
    extendedEditorConfig: {
      mode: codegenMode,
      readOnly: true,
      lineWrapping: CODE_WRAP,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

const tippyActions = ref<any | null>(null)

const toast = useToast()

const headersCopyIcon = refAutoReset<typeof IconCopy | typeof IconCheck>(
  IconCopy,
  1000
)

const copyHeaders = () => {
  copyToClipboard(
    JSON.stringify(finalHeaders.value.map(({ key, value }) => ({ key, value })))
  )
  headersCopyIcon.value = IconCheck
  toast.success(`${t("state.copied_to_clipboard")}`)
}

const { copyIcon: urlCopyIcon, copyResponse: copyUrl } =
  useCopyResponse(effectiveURL)
const { copyIcon: bodyCopyIcon, copyResponse: copyBody } = useCopyResponse(
  computed(() => bodyText.value ?? "")
)
const { copyIcon: codeCopyIcon, copyResponse: copyCode } =
  useCopyResponse(requestCode)
</script>
