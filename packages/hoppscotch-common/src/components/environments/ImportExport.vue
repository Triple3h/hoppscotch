<template>
  <ImportExportBase
    ref="collections-import-export"
    modal-title="environment.title"
    :importer-modules="importerModules"
    :exporter-modules="exporterModules"
    @hide-modal="emit('hide-modal')"
  />
</template>

<script setup lang="ts">
import { Environment, generateUniqueRefId } from "@hoppscotch/data"
import {
  populateLocalStoresFromVariables,
  promoteInitialValueForImport,
  stripClientLocalValuesForWire,
} from "~/helpers/clientLocalVariables"
import * as E from "fp-ts/Either"
import { computed, ref } from "vue"

import { ImporterOrExporter } from "~/components/importExport/types"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { hoppEnvImporter } from "~/helpers/import-export/import/hoppEnv"
import { FileSource } from "~/helpers/import-export/import/import-sources/FileSource"
import { GistSource } from "~/helpers/import-export/import/import-sources/GistSource"

import {
  addGlobalEnvVariable,
  appendEnvironments,
  environments$,
  getGlobalVariables,
} from "~/newstore/environments"

import { useService } from "dioc/vue"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { insomniaEnvImporter } from "~/helpers/import-export/import/insomnia/insomniaEnv"
import { postmanEnvImporter } from "~/helpers/import-export/import/postmanEnv"

import { useReadonlyStream } from "~/composables/stream"
import { initializeDownloadFile } from "~/helpers/import-export/export"
import { transformEnvironmentVariables } from "~/helpers/import-export/export/environment"
import { environmentsExporter } from "~/helpers/import-export/export/environments"
import { gistExporter } from "~/helpers/import-export/export/gist"
import { platform } from "~/platform"
import IconInsomnia from "~icons/hopp/insomnia"
import IconPostman from "~icons/hopp/postman"
import IconFolderPlus from "~icons/lucide/folder-plus"
import IconUser from "~icons/lucide/user"

const t = useI18n()
const toast = useToast()

// The app is personal-workspace-only, so environment imports/exports always
// target personal environments. The prop is retained because the parent
// (environments/my/index.vue) still passes `environment-type="MY_ENV"`.
defineProps<{
  environmentType: "MY_ENV"
}>()

const myEnvironments = useReadonlyStream(environments$, [])

const currentEnvironmentValueService = useService(CurrentValueService)
const secretEnvironmentService = useService(SecretEnvironmentService)

const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

const isPostmanImporterInProgress = ref(false)
const isInsomniaImporterInProgress = ref(false)
const isRESTImporterInProgress = ref(false)
const isGistImporterInProgress = ref(false)

const isEnvironmentGistExportInProgress = ref(false)

const environmentJson = computed(() => {
  return myEnvironments.value.map(transformEnvironmentVariables)
})

const workspaceType = "personal"

const HoppEnvironmentsImport: ImporterOrExporter = {
  metadata: {
    id: "import.from_json",
    name: "import.from_json",
    icon: IconFolderPlus,
    title: "import.from_json",
    applicableTo: ["personal-workspace"],
    disabled: false,
  },
  component: FileSource({
    acceptedFileTypes: "application/json",
    caption: "import.hoppscotch_environment_description",
    onImportFromFile: async (environments) => {
      isRESTImporterInProgress.value = true

      const res = await hoppEnvImporter(environments)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_ENVIRONMENT",
          platform: "rest",
          workspaceType: "personal",
        })

        emit("hide-modal")
      } else {
        showImportFailedError()
      }

      isRESTImporterInProgress.value = false
    },
    isLoading: isRESTImporterInProgress,
  }),
}

const PostmanEnvironmentsImport: ImporterOrExporter = {
  metadata: {
    id: "import.from_postman",
    name: "import.from_postman",
    icon: IconPostman,
    title: "import.from_json",
    applicableTo: ["personal-workspace"],
    disabled: false,
  },
  component: FileSource({
    acceptedFileTypes: "application/json",
    caption: "import.postman_environment_description",
    onImportFromFile: async (environments) => {
      isPostmanImporterInProgress.value = true

      const res = await postmanEnvImporter(environments)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_ENVIRONMENT",
          platform: "rest",
          workspaceType: "personal",
        })

        emit("hide-modal")
      } else {
        showImportFailedError()
      }

      isPostmanImporterInProgress.value = false
    },
    isLoading: isPostmanImporterInProgress,
  }),
}

const insomniaEnvironmentsImport: ImporterOrExporter = {
  metadata: {
    id: "import.from_insomnia",
    name: "import.from_insomnia",
    icon: IconInsomnia,
    title: "import.from_json",
    applicableTo: ["personal-workspace"],
    disabled: false,
  },
  component: FileSource({
    acceptedFileTypes: ".json, .yaml, .yml",
    caption: "import.insomnia_environment_description",
    onImportFromFile: async (environments) => {
      isInsomniaImporterInProgress.value = true

      const res = await insomniaEnvImporter(environments)()

      if (E.isRight(res)) {
        const globalEnvs = res.right.filter(
          (env) => env.name === "Base Environment"
        )
        const otherEnvs = res.right.filter(
          (env) => env.name !== "Base Environment"
        )

        await handleImportToStore(otherEnvs, globalEnvs)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_ENVIRONMENT",
          platform: "rest",
          workspaceType: "personal",
        })

        emit("hide-modal")
      } else {
        showImportFailedError()
      }

      isInsomniaImporterInProgress.value = false
    },
    isLoading: isInsomniaImporterInProgress,
  }),
}

const EnvironmentsImportFromGIST: ImporterOrExporter = {
  metadata: {
    id: "import.environments_from_gist",
    name: "import.environments_from_gist",
    icon: IconFolderPlus,
    title: "import.environments_from_gist",
    applicableTo: ["personal-workspace"],
    disabled: false,
  },
  component: GistSource({
    caption: "import.environments_from_gist_description",
    onImportFromGist: async (environments) => {
      if (E.isLeft(environments)) {
        showImportFailedError()
        return
      }

      isGistImporterInProgress.value = true

      const res = await hoppEnvImporter(environments.right)()

      if (E.isRight(res)) {
        await handleImportToStore(res.right)

        platform.analytics?.logEvent({
          type: "HOPP_IMPORT_ENVIRONMENT",
          platform: "rest",
          workspaceType: "personal",
        })
        emit("hide-modal")
      } else {
        showImportFailedError()
      }

      isGistImporterInProgress.value = false
    },
    isLoading: isGistImporterInProgress,
  }),
}

const HoppEnvironmentsExport: ImporterOrExporter = {
  metadata: {
    id: "export.as_json",
    name: "export.as_json",
    title: "action.download_file",
    icon: IconUser,
    disabled: false,
    applicableTo: ["personal-workspace"],
  },
  action: async () => {
    if (!environmentJson.value.length) {
      return toast.error(t("error.no_environments_to_export"))
    }

    const message = await initializeDownloadFile(
      environmentsExporter(environmentJson.value),
      `hoppscotch-${workspaceType}-environments`
    )

    if (E.isLeft(message)) {
      toast.error(t("export.failed"))
      return
    }

    toast.success(t("state.download_started"))

    platform.analytics?.logEvent({
      type: "HOPP_EXPORT_ENVIRONMENT",
      platform: "rest",
    })
  },
}

const HoppEnvironmentsGistExporter: ImporterOrExporter = {
  metadata: {
    id: "export.as_gist",
    name: "export.create_secret_gist",
    title:
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      currentUser?.value?.provider === "github.com"
        ? "export.create_secret_gist_tooltip_text"
        : "export.require_github",
    icon: IconUser,
    disabled: !currentUser.value
      ? true
      : currentUser.value?.provider !== "github.com",
    applicableTo: ["personal-workspace"],
    isLoading: isEnvironmentGistExportInProgress,
  },
  action: async () => {
    if (!environmentJson.value.length) {
      return toast.error(t("error.no_environments_to_export"))
    }

    if (!currentUser.value) {
      toast.error(t("profile.no_permission"))
      return
    }

    isEnvironmentGistExportInProgress.value = true

    const accessToken = currentUser.value?.accessToken

    if (accessToken) {
      const res = await gistExporter(
        JSON.stringify(environmentJson.value),
        accessToken,
        "hoppscotch-environment.json"
      )

      if (E.isLeft(res)) {
        toast.error(t("export.failed"))
        isEnvironmentGistExportInProgress.value = false
        return
      }

      toast.success(t("export.secret_gist_success"))

      platform.analytics?.logEvent({
        type: "HOPP_EXPORT_ENVIRONMENT",
        platform: "rest",
      })

      platform.kernelIO.openExternalLink({ url: res.right })
    }

    isEnvironmentGistExportInProgress.value = false
  },
}

const importerModules = [
  HoppEnvironmentsImport,
  EnvironmentsImportFromGIST,
  PostmanEnvironmentsImport,
  insomniaEnvironmentsImport,
]

const exporterModules = computed(() => {
  const enabledExporters = [HoppEnvironmentsExport]

  if (platform.platformFeatureFlags.exportAsGIST) {
    enabledExporters.push(HoppEnvironmentsGistExporter)
  }

  return enabledExporters
})

const showImportFailedError = () => {
  toast.error(t("import.failed").toString())
}

const handleImportToStore = async (
  environments: Environment[],
  globalEnvs: Environment[] = []
) => {
  // Per-env populate happens inside the MY_ENV branch below, each keyed
  // appropriately. Globals share the single `"Global"` key and must merge
  // with existing entries — hydrate, concat, populate once.
  if (globalEnvs.length > 0) {
    const importedGlobals = globalEnvs.flatMap(({ variables }) => variables)

    const existingHydrated: Environment["variables"] = getGlobalVariables().map(
      (v, i) => {
        if (v.secret) {
          const stored = secretEnvironmentService.getSecretEnvironmentVariable(
            "Global",
            i
          )
          return {
            ...v,
            initialValue: stored?.initialValue ?? "",
            currentValue: stored?.value ?? "",
          }
        }
        const stored = currentEnvironmentValueService.getEnvironmentVariable(
          "Global",
          i
        )
        return {
          ...v,
          currentValue: stored?.currentValue ?? v.currentValue,
        }
      }
    )

    // `populateLocalStoresFromVariables` is a full replace for `"Global"`.
    // Relies on the sync path above (`getGlobalVariables()` → hydrate →
    // concat) running with no awaits in between — a future refactor that
    // introduces one between the snapshot and this call would silently
    // drop any global added meanwhile.
    //
    // Promote on the IMPORTED slice only (not `existingHydrated`) so a
    // legacy export shape (`initialValue` set, `currentValue: ""`) lands
    // its secrets correctly, while user-cleared existing globals stay
    // cleared per the rehydration semantic.
    populateLocalStoresFromVariables("Global", [
      ...existingHydrated,
      ...promoteInitialValueForImport(importedGlobals),
    ])

    // Append stripped imports; varIndex aligns with the hydrated entries.
    stripClientLocalValuesForWire(importedGlobals).forEach(
      ({ key, initialValue, currentValue, secret }) => {
        addGlobalEnvVariable({ key, initialValue, currentValue, secret })
      }
    )
  }

  // Always stamp a fresh temp id, even if the export carried one —
  // re-using the exported `id` would land the populate on a store
  // entry already owned by the original environment (then the sync
  // remap would migrate that entry away, blanking the original's
  // secrets). A fresh id guarantees no collision with anything in
  // the store before the sync handler creates the new backend row.
  const envsWithIds = environments.map((env) => ({
    ...env,
    id: generateUniqueRefId("env"),
  }))

  envsWithIds.forEach((env) => {
    populateLocalStoresFromVariables(
      env.id,
      promoteInitialValueForImport(env.variables)
    )
  })

  const strippedEnvironments = envsWithIds.map((env) => ({
    ...env,
    variables: stripClientLocalValuesForWire(env.variables),
  }))
  appendEnvironments(strippedEnvironments)
  toast.success(t("state.file_imported"))
}

const emit = defineEmits<{
  (e: "hide-modal"): () => void
}>()
</script>
