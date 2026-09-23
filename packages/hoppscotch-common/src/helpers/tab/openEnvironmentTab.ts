import { Environment } from "@hoppscotch/data"
import { cloneDeep } from "lodash-es"
import {
  HoppEnvironmentDocument,
  HoppEnvironmentDraftVariable,
} from "~/helpers/tab/document"
import { uniqueID } from "~/helpers/utils/uniqueID"
import { getService } from "~/modules/dioc"
import { environmentsStore, getGlobalVariables } from "~/newstore/environments"
import { HoppTab } from "~/services/tab"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"

export type OpenEnvironmentTabOptions = {
  /** Personal environment index in the store; omit for Global / new */
  environmentIndex?: number
  isGlobal?: boolean
  isNew?: boolean
  /** Seed variables for a new draft (e.g. test-result additions) */
  seedVariables?: Environment["variables"]
  selectedVariableName?: string | null
  selectedOption?: "variables" | "secret"
}

/** Resolve store-backed current/secret values into editor draft rows. */
export function buildEnvironmentDraftRows(
  environmentID: string | "Global",
  source: Environment["variables"],
  startId = 0
): { variables: HoppEnvironmentDraftVariable[]; idTicker: number } {
  const secretService = getService(SecretEnvironmentService)
  const currentService = getService(CurrentValueService)

  let id = startId
  const variables: HoppEnvironmentDraftVariable[] = source.map((e, index) => {
    const rowId = id++
    const currentValue = e.secret
      ? (secretService.getSecretEnvironmentVariable(environmentID, index)
          ?.value ?? e.currentValue)
      : (currentService.getEnvironmentVariable(environmentID, index)
          ?.currentValue ?? e.currentValue)
    const initialValue = e.secret
      ? (secretService.getSecretEnvironmentVariable(environmentID, index)
          ?.initialValue ?? e.initialValue)
      : e.initialValue

    return {
      id: rowId,
      env: {
        key: e.key,
        initialValue,
        currentValue,
        secret: e.secret,
      },
    }
  })

  return { variables, idTicker: id }
}

/**
 * Open (or focus) an environment editor as a workspace tab — same pattern as
 * collection/folder tabs: the tab owns a draft and saves on Ctrl/Cmd+S.
 */
export function openEnvironmentTab(
  options: OpenEnvironmentTabOptions = {}
): HoppTab<HoppEnvironmentDocument> | null {
  const {
    environmentIndex,
    isGlobal = false,
    isNew = false,
    seedVariables,
    selectedVariableName = null,
    selectedOption = "variables",
  } = options

  const tabs = getService(WorkspaceTabsService)

  let environmentID: string
  let name = ""
  let color = ""
  let sourceVariables: Environment["variables"] = []

  if (isGlobal) {
    environmentID = "Global"
    name = "Global"
    sourceVariables = seedVariables
      ? [...getGlobalVariables(), ...cloneDeep(seedVariables)]
      : getGlobalVariables()
  } else if (isNew) {
    environmentID = uniqueID()
    sourceVariables = seedVariables ? cloneDeep(seedVariables) : []
  } else if (typeof environmentIndex === "number") {
    const env = environmentsStore.value.environments[environmentIndex]
    if (!env) return null
    environmentID = env.id
    name = env.name
    color = env.color ?? ""
    sourceVariables = env.variables
  } else {
    return null
  }

  // Dedupe: one tab per environment id; one Global tab; one "new" draft tab.
  const existing = Array.from(tabs.getTabs()).find((tab) => {
    if (tab.document.type !== "environment") return false
    if (isNew) return tab.document.isNew
    return (
      !tab.document.isNew &&
      tab.document.environmentID === environmentID &&
      tab.document.isGlobal === isGlobal
    )
  })

  if (existing) {
    if (existing.document.type !== "environment") return null
    // Keep an in-progress draft; only refresh focus + open hints
    if (selectedVariableName) {
      existing.document.selectedVariableName = selectedVariableName
    }
    if (selectedOption) {
      existing.document.selectedOption = selectedOption
    }
    tabs.setActiveTab(existing.id)
    return existing as HoppTab<HoppEnvironmentDocument>
  }

  const { variables, idTicker } = buildEnvironmentDraftRows(
    environmentID,
    sourceVariables
  )

  const document: HoppEnvironmentDocument = {
    type: "environment",
    environmentID,
    isGlobal,
    isNew,
    name,
    color,
    variables,
    selectedOption,
    selectedVariableName,
    idTicker,
    // A brand-new draft with seeded vars has unsaved content
    isDirty: isNew && variables.some((v) => v.env.key !== ""),
  }

  return tabs.createNewTab(document) as HoppTab<HoppEnvironmentDocument>
}
