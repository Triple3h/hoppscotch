import type {
  GQLHeader,
  HoppCollection,
  HoppCollectionVariable,
  HoppGQLAuth,
  HoppRESTAuth,
  HoppRESTHeaders,
} from "@hoppscotch/data"
import { getService } from "~/modules/dioc"
import * as A from "fp-ts/Array"
import { flow, pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import { clone } from "lodash-es"
import { nextTick } from "vue"
import { stripClientLocalValuesForWire } from "~/helpers/clientLocalVariables"
import { updateInheritedPropertiesForAffectedRequests } from "~/helpers/collection/collection"
import {
  editRESTCollection,
  editRESTFolder,
  navigateToFolderWithIndexPath,
  restCollectionStore,
} from "~/newstore/collections"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"

export type HoppCollectionAuth = HoppRESTAuth | HoppGQLAuth
export type HoppCollectionHeaders = HoppRESTHeaders | GQLHeader[]

/**
 * The editable slice of a collection/folder — the part the properties UI
 * owns. Everything else in `HoppCollection` (id, folders, …) is stored
 * elsewhere and deliberately left out so a save never writes back a stale
 * copy of the subtree.
 */
export type EditableCollectionProperties = {
  headers: HoppCollectionHeaders
  auth: HoppCollectionAuth
  variables: HoppCollectionVariable[]
  preRequestScript: string
  testScript: string
}

export const makeEditableCollection = (
  collection: Partial<HoppCollection>
): EditableCollectionProperties => ({
  headers: clone((collection.headers ?? []) as HoppCollectionHeaders),
  auth: clone(
    (collection.auth ?? {
      authType: "inherit",
      authActive: false,
    }) as HoppCollectionAuth
  ),
  variables: clone(collection.variables ?? []),
  preRequestScript: collection.preRequestScript ?? "",
  testScript: collection.testScript ?? "",
})

/**
 * Key a collection's secret/current variable values are stored under — mirrors
 * the keying used on the save side so reads and writes line up.
 */
export const collectionVariableStoreKey = (
  collection: Partial<HoppCollection>,
  path: string
) => collection._ref_id ?? collection.id ?? path.split("/").pop() ?? ""

/**
 * Re-populates `currentValue`/`initialValue` from the local secret and current
 * value stores: both are blanked at the wire boundary before a collection is
 * persisted, so a collection loaded straight from the store shows empty
 * values.
 */
export const withStoredVariableValues = (
  collection: Partial<HoppCollection>,
  path: string
): HoppCollectionVariable[] => {
  const secretEnvironmentService = getService(SecretEnvironmentService)
  const currentEnvironmentValueService = getService(CurrentValueService)
  const storeKey = collectionVariableStoreKey(collection, path)

  return pipe(
    collection.variables ?? [],
    A.mapWithIndex((index, variable) => {
      if (!variable.secret) {
        return {
          ...variable,
          currentValue:
            currentEnvironmentValueService.getEnvironmentVariable(
              storeKey,
              index
            )?.currentValue ?? variable.currentValue,
        }
      }

      const stored = secretEnvironmentService.getSecretEnvironmentVariableValue(
        storeKey,
        index
      )

      return {
        ...variable,
        currentValue:
          stored?.value ??
          secretEnvironmentService.getSecretEnvironmentVariable(storeKey, index)
            ?.value ??
          variable.currentValue,
        initialValue: stored?.initialValue ?? variable.initialValue,
      }
    })
  )
}

/**
 * Writes a collection's properties back to the store: secrets are moved into
 * the secret store (and stripped from the wire payload), everything else goes
 * through the regular collection dispatcher. `path` is the collection's index
 * path in the collection store ("0/2"); a single-segment path is a root
 * collection.
 *
 * Returns `false` without writing when the path no longer points at this
 * collection: paths are reused after deletes/reorders, and a tab can sit open
 * for long enough to be looking at a stale one.
 */
export const persistCollectionProperties = (
  path: string,
  collection: Partial<HoppCollection>
): boolean => {
  const target = navigateToFolderWithIndexPath(
    restCollectionStore.value.state,
    path.split("/").map((index) => parseInt(index))
  )

  const targetRefID = target?._ref_id ?? target?.id
  const ownRefID = collection._ref_id ?? collection.id

  if (!target || (targetRefID && ownRefID && targetRefID !== ownRefID))
    return false

  const payload = clone(collection)

  if (payload.variables) {
    const secretEnvironmentService = getService(SecretEnvironmentService)
    const currentEnvironmentValueService = getService(CurrentValueService)
    const storeKey = collectionVariableStoreKey(payload, path)

    const filteredVariables = pipe(
      payload.variables,
      A.filterMap(
        flow(
          O.fromPredicate((variable) => variable.key !== ""),
          O.map((variable) => variable)
        )
      )
    )

    const secretVariables = pipe(
      filteredVariables,
      A.filterMapWithIndex((index, variable) =>
        variable.secret
          ? O.some({
              key: variable.key,
              value: variable.currentValue,
              initialValue: variable.initialValue,
              varIndex: index,
            })
          : O.none
      )
    )

    const nonSecretVariables = pipe(
      filteredVariables,
      A.filterMapWithIndex((index, variable) =>
        !variable.secret
          ? O.some({
              key: variable.key,
              currentValue: variable.currentValue,
              varIndex: index,
              isSecret: variable.secret ?? false,
            })
          : O.none
      )
    )

    secretEnvironmentService.addSecretEnvironment(storeKey, secretVariables)
    currentEnvironmentValueService.addEnvironment(storeKey, nonSecretVariables)

    payload.variables = stripClientLocalValuesForWire(filteredVariables)
  }

  if (path.split("/").length === 1) {
    editRESTCollection(parseInt(path), payload)
  } else {
    editRESTFolder(path, payload)
  }

  nextTick(() => updateInheritedPropertiesForAffectedRequests(path, "rest"))

  return true
}
