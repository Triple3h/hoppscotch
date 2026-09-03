<template>
  <ImportExportBase
    ref="collections-import-export"
    modal-title="modal.collections"
    :importer-modules="importerModules"
    :exporter-modules="exporterModules"
    @hide-modal="emit('hide-modal')"
  />
</template>

<script setup lang="ts">
import { HoppCollection } from "@hoppscotch/data"
import * as E from "fp-ts/Either"
import { PropType, Ref, computed, ref } from "vue"

import { FileSource } from "~/helpers/import-export/import/import-sources/FileSource"
import { UrlSource } from "~/helpers/import-export/import/import-sources/UrlSource"

import IconDownload from "~icons/lucide/download"
import IconFile from "~icons/lucide/file"
import yaml from "js-yaml"

import {
  harImporter,
  hoppInsomniaImporter,
  hoppOpenAPIImporter,
  hoppPostmanImporter,
  hoppRESTImporter,
} from "~/helpers/import-export/import/importers"

import { defineStep } from "~/composables/step-components"

import AllCollectionImport from "~/components/importExport/ImportExportSteps/AllCollectionImport.vue"
import CollectionsExportFormatStep from "~/components/collections/ExportFormatStep.vue"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { appendRESTCollections, restCollections$ } from "~/newstore/collections"
import {
  ensureRefIds,
  populateLocalStoresFromCollectionTree,
  stripCollectionTreeForStore,
} from "~/helpers/clientLocalVariables"

import IconInsomnia from "~icons/hopp/insomnia"
import IconPostman from "~icons/hopp/postman"
import IconOpenAPI from "~icons/lucide/file"
import IconFolderPlus from "~icons/lucide/folder-plus"
import IconGithub from "~icons/lucide/github"
import IconLink from "~icons/lucide/link"

import { useReadonlyStream } from "~/composables/stream"
import IconUser from "~icons/lucide/user"

import { platform } from "~/platform"

import {
  initializeDownloadFile,
  stripRefIdReplacer,
} from "~/helpers/import-export/export"
import { gistExporter } from "~/helpers/import-export/export/gist"
import { myCollectionsExporter } from "~/helpers/import-export/export/myCollections"
import { hoppCollectionsToOpenAPI } from "~/helpers/import-export/export/openapi"

import { ImporterOrExporter } from "~/components/importExport/types"
import { GistSource } from "~/helpers/import-export/import/import-sources/GistSource"
import { sanitizeCollection } from "~/helpers/import-export/import"

const isInsomniaImporterInProgress = ref(false)
const isOpenAPIImporterInProgress = ref(false)
const isRESTImporterInProgress = ref(false)
const isAllCollectionImporterInProgress = ref(false)
const isHarImporterInProgress = ref(false)
const isGistImporterInProgress = ref(false)

const t = useI18n()
const toast = useToast()

type CollectionType = { type: "my-collections" }

defineProps({
  collectionsType: {
    type: Object as PropType<CollectionType>,
    default: () => ({
      type: "my-collections",
    }),
    required: true,
  },
})

const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

const myCollections = useReadonlyStream(restCollections$, [])

const showImportFailedError = () => {
  toast.error(t("import.failed"))
}

const handleImportToStore = async (collections: HoppCollection[]) => {
  const importResult = await importToPersonalWorkspace(collections)

  if (E.isRight(importResult)) {
    toast.success(t("state.file_imported"))
  } else {
    toast.error(t("import.failed"))
  }
}

/**
 * Import collections to personal workspace
 * We sanitize the collections before importing to remove old id from the imported collection and folders and transform it to new collection format
 * @param collections Collections to import
 */
const importToPersonalWorkspace = (collections: HoppCollection[]) => {
  // Remove old id from the imported collection and folders and transform it to new collection format
  const sanitizedCollections = collections
    .map(sanitizeCollection)
    .map(ensureRefIds)

  sanitizedCollections.forEach(populateLocalStoresFromCollectionTree)

  appendRESTCollections(sanitizedCollections.map(stripCollectionTreeForStore))
  return E.right({ success: true })
}

const emit = defineEmits<{
  (e: "hide-modal"): () => void
}>()

const isWorkspaceExportInProgress = ref(false)
const isHoppGistCollectionExporterInProgress = ref(false)
const isPostmanImporterInProgress = ref(false)

const currentImportSummary: Ref<{
  showImportSummary: boolean
  importedCollections: HoppCollection[] | null
  scriptsImported?: boolean
  originalScriptCounts?: { preRequest: number; test: number }
}> = ref({
  showImportSummary: false,
  importedCollections: null,
  scriptsImported: false,
  originalScriptCounts: undefined,
})

const setCurrentImportSummary = (
  collections: HoppCollection[],
  scriptsImported?: boolean,
  originalScriptCounts?: { preRequest: number; test: number }
) => {
  currentImportSummary.value.importedCollections = collections
  currentImportSummary.value.showImportSummary = true
  currentImportSummary.value.scriptsImported = scriptsImported
  currentImportSummary.value.originalScriptCounts = originalScriptCounts
}

const unsetCurrentImportSummary = () => {
  currentImportSummary.value.importedCollections = null
  currentImportSummary.value.showImportSummary = false
  currentImportSummary.value.scriptsImported = false
  currentImportSummary.value.originalScriptCounts = undefined
}

// Count scripts in raw Postman collection JSON (before import strips them)
const countPostmanScripts = (
  content: string[]
): { preRequest: number; test: number } => {
  let preRequestCount = 0
  let testCount = 0

  const countInItem = (item: any) => {
    // Only count if this is a request (has request object), not a folder
    const isRequest = item?.request !== undefined

    if (isRequest && item?.event) {
      const prerequest = item.event.find((e: any) => e.listen === "prerequest")
      const test = item.event.find((e: any) => e.listen === "test")

      if (
        prerequest?.script?.exec &&
        Array.isArray(prerequest.script.exec) &&
        prerequest.script.exec.some((line: string) => line?.trim())
      ) {
        preRequestCount++
      }

      if (
        test?.script?.exec &&
        Array.isArray(test.script.exec) &&
        test.script.exec.some((line: string) => line?.trim())
      ) {
        testCount++
      }
    }

    // Recursively count in nested items (folders)
    if (item?.item && Array.isArray(item.item)) {
      item.item.forEach(countInItem)
    }
  }

  content.forEach((fileContent) => {
    try {
      const collection = JSON.parse(fileContent)
      if (collection?.item && Array.isArray(collection.item)) {
        collection.item.forEach(countInItem)
      }
    } catch (_e) {
      // Invalid JSON, skip
    }
  })

  return { preRequest: preRequestCount, test: testCount }
}

const HoppRESTImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_rest",
    name: "import.from_json",
    title: "import.from_json_description",
    icon: IconFolderPlus,
    disabled: false,
    applicableTo: ["personal-workspace", "url-import"],
    format: "hoppscotch",
  },
  importSummary: currentImportSummary,
  component: FileSource({
    caption: "import.from_file",
    acceptedFileTypes: ".json",
    onImportFromFile: async (content) => {
      isRESTImporterInProgress.value = true
      const res = await hoppRESTImporter(content)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        setCurrentImportSummary(res.right)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_COLLECTION",
          importer: "import.from_json",
          platform: "rest",
          workspaceType: "personal",
        })
      } else {
        showImportFailedError()

        unsetCurrentImportSummary()
      }

      isRESTImporterInProgress.value = false
    },
    description: "import.from_hoppscotch_importer_summary",
    isLoading: isRESTImporterInProgress,
  }),
}

const HoppAllCollectionImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_all_collection",
    name: "import.from_all_collections",
    title: "import.from_all_collections_description",
    icon: IconUser,
    disabled: false,
    applicableTo: ["personal-workspace"],
    format: "hoppscotch",
  },
  importSummary: currentImportSummary,
  component: defineStep("all_collection_import", AllCollectionImport, () => ({
    loading: isAllCollectionImporterInProgress.value,
    async onImportCollection(content) {
      isAllCollectionImporterInProgress.value = true

      try {
        await handleImportToStore([content])
        setCurrentImportSummary([content])

        // our analytics consider this as an export event, so keeping compatibility with that
        platform.analytics?.logEvent({
          type: "HOPP_EXPORT_COLLECTION",
          exporter: "json",
          platform: "rest",
        })
      } catch (_e) {
        showImportFailedError()
        unsetCurrentImportSummary()
      }

      isAllCollectionImporterInProgress.value = false
    },
  })),
}

const HoppOpenAPIImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_openapi",
    name: "import.from_openapi",
    title: "import.from_openapi_description",
    icon: IconOpenAPI,
    disabled: false,
    applicableTo: ["personal-workspace", "url-import"],
    format: "openapi",
  },
  importSummary: currentImportSummary,
  supported_sources: [
    {
      id: "file_import",
      name: "import.from_file",
      icon: IconFile,
      step: FileSource({
        caption: "import.from_file",
        acceptedFileTypes: ".json, .yaml, .yml",
        description: "import.from_openapi_import_summary",
        onImportFromFile: async (content) => {
          isOpenAPIImporterInProgress.value = true

          const res = await hoppOpenAPIImporter(content)()

          if (E.isRight(res)) {
            await handleImportToStore(res.right)

            setCurrentImportSummary(res.right)

            platform.analytics?.logEvent({
              platform: "rest",
              type: "HOPP_IMPORT_COLLECTION",
              importer: "import.from_openapi",
              workspaceType: "personal",
            })
          } else {
            showImportFailedError()

            unsetCurrentImportSummary()
          }

          isOpenAPIImporterInProgress.value = false
        },
        isLoading: isOpenAPIImporterInProgress,
      }),
    },
    {
      id: "url_import",
      name: "import.from_url",
      icon: IconLink,
      step: UrlSource({
        caption: "import.from_url",
        description: "import.from_openapi_import_summary",
        onImportFromURL: async (content) => {
          isOpenAPIImporterInProgress.value = true

          const res = await hoppOpenAPIImporter([content])()

          if (E.isRight(res)) {
            await handleImportToStore(res.right)

            setCurrentImportSummary(res.right)

            platform.analytics?.logEvent({
              platform: "rest",
              type: "HOPP_IMPORT_COLLECTION",
              importer: "import.from_openapi",
              workspaceType: "personal",
            })
          } else {
            showImportFailedError()

            unsetCurrentImportSummary()
          }

          isOpenAPIImporterInProgress.value = false
        },
        isLoading: isOpenAPIImporterInProgress,
      }),
    },
  ],
}

const HoppPostmanImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_postman",
    name: "import.from_postman",
    title: "import.from_postman_description",
    icon: IconPostman,
    disabled: false,
    applicableTo: ["personal-workspace", "url-import"],
    format: "postman",
  },
  importSummary: currentImportSummary,
  component: FileSource({
    caption: "import.from_file",
    acceptedFileTypes: ".json",
    description: "import.from_postman_import_summary",
    showPostmanScriptOption: true,
    onImportFromFile: async (content: string[], importScripts?: boolean) => {
      isPostmanImporterInProgress.value = true

      // Count scripts from raw Postman JSON before importing
      const originalCounts =
        importScripts === undefined ? countPostmanScripts(content) : undefined

      const res = await hoppPostmanImporter(content, importScripts ?? false)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        setCurrentImportSummary(res.right, importScripts, originalCounts)

        platform.analytics?.logEvent({
          platform: "rest",
          type: "HOPP_IMPORT_COLLECTION",
          importer: "import.from_postman",
          workspaceType: "personal",
        })
      } else {
        showImportFailedError()

        unsetCurrentImportSummary()
      }

      isPostmanImporterInProgress.value = false
    },
    isLoading: isPostmanImporterInProgress,
  }),
}

const HoppInsomniaImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_insomnia",
    name: "import.from_insomnia",
    title: "import.from_insomnia_description",
    icon: IconInsomnia,
    disabled: false,
    applicableTo: ["personal-workspace", "url-import"],
    format: "insomnia",
  },
  importSummary: currentImportSummary,
  component: FileSource({
    caption: "import.from_file",
    acceptedFileTypes: ".json, .yaml, .yml, .har",
    description: "import.from_insomnia_import_summary",
    onImportFromFile: async (content) => {
      isInsomniaImporterInProgress.value = true

      const res = await hoppInsomniaImporter(content)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        setCurrentImportSummary(res.right)

        platform.analytics?.logEvent({
          platform: "rest",
          type: "HOPP_IMPORT_COLLECTION",
          importer: "import.from_insomnia",
          workspaceType: "personal",
        })
      } else {
        showImportFailedError()

        unsetCurrentImportSummary()
      }

      isInsomniaImporterInProgress.value = false
    },
    isLoading: isInsomniaImporterInProgress,
  }),
}

const HoppGistImporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_gist",
    name: "import.from_gist",
    title: "import.from_gist_description",
    icon: IconGithub,
    disabled: false,
    applicableTo: ["personal-workspace", "url-import"],
    format: "hoppscotch",
  },
  importSummary: currentImportSummary,
  component: GistSource({
    caption: "import.from_url",
    description: "import.from_gist_import_summary",
    onImportFromGist: async (content) => {
      if (E.isLeft(content)) {
        showImportFailedError()
        return
      }

      isGistImporterInProgress.value = true

      const res = await hoppRESTImporter(content.right)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        setCurrentImportSummary(res.right)

        platform.analytics?.logEvent({
          platform: "rest",
          type: "HOPP_IMPORT_COLLECTION",
          importer: "import.from_gist",
          workspaceType: "personal",
        })
      } else {
        showImportFailedError()

        unsetCurrentImportSummary()
      }

      isGistImporterInProgress.value = false
    },
    isLoading: isGistImporterInProgress,
  }),
}

/**
 * Resolve the array of HoppCollections for the current workspace (personal).
 */
const getWorkspaceCollections = async (): Promise<{
  collections: HoppCollection[]
  workspaceName: string
  fileBaseName: string
} | null> => {
  if (!myCollections.value.length) {
    toast.error(t("error.no_collections_to_export"))
    return null
  }
  return {
    collections: myCollections.value,
    workspaceName: "Hoppscotch personal collections",
    fileBaseName: "hoppscotch-personal-collections",
  }
}

const onWorkspaceExportHopp = async () => {
  // Keep the modal open during serialization. Closing early hid that latency
  // from the user.
  isWorkspaceExportInProgress.value = true
  let saved = false
  try {
    const ctx = await getWorkspaceCollections()
    if (!ctx) return

    const json = myCollectionsExporter(ctx.collections)

    const message = await initializeDownloadFile(json, ctx.fileBaseName)
    if (E.isRight(message)) {
      toast.success(t(message.right))
      platform.analytics?.logEvent({
        type: "HOPP_EXPORT_COLLECTION",
        exporter: "json",
        platform: "rest",
      })
      saved = true
    } else {
      toast.error(t(message.left))
    }
  } catch {
    toast.error(t("export.failed"))
  } finally {
    isWorkspaceExportInProgress.value = false
    // Only close the parent modal when the file actually saved. On cancel,
    // no-data, or error the user stays on the format chooser so toasts and
    // state remain visible and they can retry.
    if (saved) emit("hide-modal")
  }
}

const onWorkspaceExportOpenAPI = async (format: "json" | "yaml") => {
  isWorkspaceExportInProgress.value = true
  let saved = false
  try {
    const ctx = await getWorkspaceCollections()
    if (!ctx) return

    // The chooser modal already shows the full list of OpenAPI lossiness
    // categories upfront, so the converter's post-export warnings would be
    // redundant — drop them.
    const { doc } = hoppCollectionsToOpenAPI(ctx.workspaceName, ctx.collections)

    const isYaml = format === "yaml"
    let data: string
    try {
      data = isYaml ? yaml.dump(doc) : JSON.stringify(doc, null, 2)
    } catch {
      toast.error(t("error.something_went_wrong"))
      return
    }
    const extension = isYaml ? "yaml" : "json"
    const result = await platform.kernelIO.saveFileWithDialog({
      data,
      contentType: isYaml ? "application/x-yaml" : "application/json",
      suggestedFilename: `${ctx.fileBaseName}-openapi.${extension}`,
      filters: [
        {
          name: `OpenAPI ${extension.toUpperCase()} file`,
          extensions: [extension],
        },
      ],
    })
    if (result.type === "saved" || result.type === "unknown") {
      toast.success(t("state.download_started").toString())
      platform.analytics?.logEvent({
        type: "HOPP_EXPORT_COLLECTION",
        exporter: "openapi",
        platform: "rest",
      })
      saved = true
    }
  } catch {
    toast.error(t("export.failed"))
  } finally {
    isWorkspaceExportInProgress.value = false
    if (saved) emit("hide-modal")
  }
}

// In-modal step that renders the format chooser (Hoppscotch JSON / OpenAPI
// JSON / OpenAPI YAML + lossiness disclosure). Registered as the exporter's
// `component` so ImportExportBase advances to it on click instead of opening
// a parallel modal.
const exportFormatStep = defineStep(
  "collections_export_format",
  CollectionsExportFormatStep,
  () => ({
    loading: isWorkspaceExportInProgress.value,
    "onExport-hoppscotch": () => {
      onWorkspaceExportHopp()
    },
    "onExport-openapi": (format: "json" | "yaml") => {
      onWorkspaceExportOpenAPI(format)
    },
  })
)

const HoppCollectionsExporter: ImporterOrExporter = {
  metadata: {
    id: "hopp_collections_export",
    name: "export.collections",
    title: "export.choose_format",
    icon: IconDownload,
    disabled: false,
    applicableTo: ["personal-workspace"],
    isLoading: isWorkspaceExportInProgress,
  },
  importSummary: currentImportSummary,
  component: exportFormatStep,
}

const HoppGistCollectionsExporter: ImporterOrExporter = {
  metadata: {
    id: "create_secret_gist",
    name: "export.create_secret_gist",
    icon: IconGithub,
    disabled: !currentUser.value
      ? true
      : currentUser.value?.provider !== "github.com",
    title:
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      currentUser?.value?.provider === "github.com"
        ? "export.create_secret_gist_tooltip_text"
        : "export.require_github",
    applicableTo: ["personal-workspace"],
    isLoading: isHoppGistCollectionExporterInProgress,
  },
  action: async () => {
    isHoppGistCollectionExporterInProgress.value = true

    const collectionJSON = await getCollectionJSON()
    const accessToken = currentUser.value?.accessToken

    if (!accessToken) {
      toast.error(t("error.something_went_wrong"))
      isHoppGistCollectionExporterInProgress.value = false
      return
    }

    if (E.isRight(collectionJSON)) {
      const res = await gistExporter(collectionJSON.right, accessToken)

      if (E.isLeft(res)) {
        toast.error(t("export.failed"))
        return
      }

      toast.success(t("export.secret_gist_success"))

      platform.analytics?.logEvent({
        type: "HOPP_EXPORT_COLLECTION",
        exporter: "gist",
        platform: "rest",
      })

      platform.kernelIO.openExternalLink({ url: res.right })
    } else {
      toast.error(collectionJSON.left)
    }

    isHoppGistCollectionExporterInProgress.value = false
  },
}

const HARImporter: ImporterOrExporter = {
  metadata: {
    id: "har",
    name: "import.from_har",
    title: "import.from_har_description",
    icon: IconFile,
    disabled: false,
    applicableTo: ["personal-workspace"],
    format: "har",
  },
  importSummary: currentImportSummary,
  component: FileSource({
    caption: "import.from_file",
    acceptedFileTypes: ".har",
    description: "import.from_har_import_summary",
    onImportFromFile: async (content) => {
      isHarImporterInProgress.value = true

      const res = await harImporter(content)

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        setCurrentImportSummary(res.right)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_COLLECTION",
          importer: "import.from_har",
          platform: "rest",
          workspaceType: "personal",
        })
      } else {
        showImportFailedError()

        unsetCurrentImportSummary()
      }

      isHarImporterInProgress.value = false
    },
    isLoading: isHarImporterInProgress,
  }),
}

const importerModules = computed(() => {
  const enabledImporters = [
    HoppRESTImporter,
    HoppAllCollectionImporter,
    HoppOpenAPIImporter,
    HoppPostmanImporter,
    HoppInsomniaImporter,
    HoppGistImporter,
    HARImporter,
  ]

  return enabledImporters.filter((importer) => {
    if (importer.metadata.disabled) {
      return false
    }

    return importer.metadata.applicableTo.includes("personal-workspace")
  })
})

const exporterModules = computed(() => {
  const enabledExporters = [HoppCollectionsExporter]

  if (platform.platformFeatureFlags.exportAsGIST) {
    enabledExporters.push(HoppGistCollectionsExporter)
  }

  return enabledExporters.filter((exporter) => {
    return exporter.metadata.applicableTo.includes("personal-workspace")
  })
})

const getCollectionJSON = async () => {
  const stripped = myCollections.value.map(stripCollectionTreeForStore)
  return E.right(JSON.stringify(stripped, stripRefIdReplacer, 2))
}
</script>
