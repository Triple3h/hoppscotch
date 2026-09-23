import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import {
  parseRawKeyValueEntriesE,
  rawKeyValueEntriesToString,
  RawKeyValueEntry,
} from "@hoppscotch/data"
import * as A from "fp-ts/Array"
import * as E from "fp-ts/Either"
import { flow, pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import * as RA from "fp-ts/ReadonlyArray"
import { cloneDeep, isEqual } from "lodash-es"
import { Ref, ref, watch } from "vue"

import { useService } from "dioc/vue"
import { useNestedSetting } from "~/composables/settings"
import { throwError } from "~/helpers/functional/error"
import { objRemoveKey } from "~/helpers/functional/object"
import { InspectionService, InspectorResult } from "~/services/inspection"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"

export type KeyValueRow = {
  key: string
  value: string
  active: boolean
  description: string
}

export type MaskableHeader = {
  source: string
  header: { value: string }
}

const emptyRow = <T extends KeyValueRow>(id: number): T & { id: number } =>
  ({
    id,
    key: "",
    value: "",
    active: true,
    description: "",
  }) as T & { id: number }

/**
 * Shared row-edit state machine for http/gql Headers panels:
 * working list (+ trailing empty row), request↔working↔bulk sync,
 * bulk mode + wrap setting, inspection views, auth-header masking.
 *
 * ponytail: covers the two Headers panels only — promote to a generic
 * table component if a third editor (params/variables) needs the same machine.
 */
export function useKeyValueTable<T extends KeyValueRow>(
  model: Ref<{ headers: T[] }>,
  opts: { wrapSetting: "httpHeaders" | "graphqlHeaders" }
) {
  const t = useI18n()
  const toast = useToast()

  const idTicker = ref(0)

  const bulkMode = ref(false)
  const bulkHeaders = ref("")
  const bulkEditor = ref<any | null>(null)
  const WRAP_LINES = useNestedSetting("WRAP_LINES", opts.wrapSetting)

  const deletionToast = ref<{ goAway: (delay: number) => void } | null>(null)

  // The UI representation of the headers list (has the empty end headers)
  const workingHeaders = ref<Array<T & { id: number }>>([
    emptyRow(idTicker.value++),
  ])

  // Rule: Working Headers always have last element is always an empty header
  watch(workingHeaders, (headersList) => {
    if (
      headersList.length > 0 &&
      headersList[headersList.length - 1].key !== ""
    ) {
      workingHeaders.value.push(emptyRow(idTicker.value++))
    }
  })

  // Sync logic between headers and working/bulk headers
  watch(
    () => model.value.headers,
    (newHeadersList) => {
      // Sync should overwrite working headers
      const filteredWorkingHeaders = pipe(
        workingHeaders.value,
        A.filterMap(
          flow(
            O.fromPredicate((e) => e.key !== ""),
            O.map(objRemoveKey("id"))
          )
        )
      )

      const filteredBulkHeaders = pipe(
        parseRawKeyValueEntriesE(bulkHeaders.value),
        E.map(
          flow(
            RA.filter((e) => e.key !== ""),
            RA.toArray
          )
        ),
        E.getOrElse(() => [] as RawKeyValueEntry[])
      )

      if (!isEqual(newHeadersList, filteredWorkingHeaders)) {
        workingHeaders.value = pipe(
          newHeadersList,
          A.map((x) => ({ id: idTicker.value++, ...x }))
        )
      }

      const newHeadersListKeyValuePairs = newHeadersList.map(
        ({ key, value, active }) => ({
          key,
          value,
          active,
        })
      )

      if (!isEqual(newHeadersListKeyValuePairs, filteredBulkHeaders)) {
        bulkHeaders.value = rawKeyValueEntriesToString(
          newHeadersListKeyValuePairs
        )
      }
    },
    { immediate: true }
  )

  watch(workingHeaders, (newWorkingHeaders) => {
    const fixedHeaders = pipe(
      newWorkingHeaders,
      A.filterMap(
        flow(
          O.fromPredicate((e) => e.key !== ""),
          O.map(objRemoveKey("id"))
        )
      )
    )

    if (!isEqual(model.value.headers, fixedHeaders)) {
      model.value.headers = cloneDeep(fixedHeaders)
    }
  })

  watch(bulkHeaders, (newBulkHeaders) => {
    const filteredBulkHeaders = pipe(
      parseRawKeyValueEntriesE(newBulkHeaders),
      E.map(
        flow(
          RA.filter((e) => e.key !== ""),
          RA.toArray
        )
      ),
      E.getOrElse(() => [] as RawKeyValueEntry[])
    )

    const headers = model.value.headers

    const paramKeyValuePairs = headers.map(({ key, value, active }) => ({
      key,
      value,
      active,
    }))

    if (!isEqual(paramKeyValuePairs, filteredBulkHeaders)) {
      model.value.headers = filteredBulkHeaders.map((param, idx) => ({
        ...param,
        // Adding a new key-value pair in the bulk edit context won't have a corresponding entry under `headers`, hence the fallback
        description: headers[idx]?.description ?? "",
      })) as T[]
    }
  })

  const addHeader = () => {
    workingHeaders.value.push(emptyRow(idTicker.value++))
  }

  const updateHeader = (index: number, header: T & { id: number }) => {
    workingHeaders.value = workingHeaders.value.map((h, i) =>
      i === index ? header : h
    )
  }

  const deleteHeader = (index: number) => {
    const headersBeforeDeletion = cloneDeep(workingHeaders.value)

    if (!(
      headersBeforeDeletion.length > 0 &&
      index === headersBeforeDeletion.length - 1
    )) {
      if (deletionToast.value) {
        deletionToast.value.goAway(0)
        deletionToast.value = null
      }

      deletionToast.value = toast.success(`${t("state.deleted")}`, {
        action: [
          {
            text: `${t("action.undo")}`,
            onClick: (_, toastObject) => {
              workingHeaders.value = headersBeforeDeletion
              toastObject.goAway(0)
              deletionToast.value = null
            },
          },
        ],

        onComplete: () => {
          deletionToast.value = null
        },
      })
    }

    workingHeaders.value = pipe(
      workingHeaders.value,
      A.deleteAt(index),
      O.getOrElseW(() => throwError("Working Headers Deletion Out of Bounds"))
    )
  }

  const clearContent = () => {
    workingHeaders.value = [emptyRow(idTicker.value++)]
    bulkHeaders.value = ""
  }

  // Inspection
  const inspectionService = useService(InspectionService)
  const tabs = useService(WorkspaceTabsService)

  const headerKeyResults = inspectionService.getResultViewFor(
    tabs.currentTabID.value,
    (result) =>
      result.locations.type === "header" && result.locations.position === "key"
  )

  const headerValueResults = inspectionService.getResultViewFor(
    tabs.currentTabID.value,
    (result) =>
      result.locations.type === "header" &&
      result.locations.position === "value"
  )

  const getInspectorResult = (results: InspectorResult[], index: number) => {
    return results.filter((result) => {
      if (
        result.locations.type === "url" ||
        result.locations.type === "response" ||
        result.locations.type === "body-content-type-header"
      )
        return
      return result.locations.index === index
    })
  }

  // Auth-header value masking (computed / inherited rows)
  const masking = ref(true)

  const toggleMask = () => {
    masking.value = !masking.value
  }

  const mask = (header: MaskableHeader) => {
    if (header.source === "auth" && masking.value)
      return header.header.value.replace(/\S/gi, "*")
    return header.header.value
  }

  return {
    bulkMode,
    bulkHeaders,
    bulkEditor,
    WRAP_LINES,
    workingHeaders,
    addHeader,
    updateHeader,
    deleteHeader,
    clearContent,
    headerKeyResults,
    headerValueResults,
    getInspectorResult,
    masking,
    toggleMask,
    mask,
  }
}
