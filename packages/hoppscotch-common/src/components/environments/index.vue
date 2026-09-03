<template>
  <div>
    <div
      class="sticky top-0 z-10 flex flex-shrink-0 flex-col overflow-x-auto bg-primary"
    >
      <WorkspaceCurrent :section="t('tab.environments')" />
      <EnvironmentsMyEnvironment
        environment-index="Global"
        :environment="globalEnvironment"
        :duplicate-global-environment-loading="
          duplicateGlobalEnvironmentLoading
        "
        class="border-b border-dividerLight"
        @duplicate-global-environment="duplicateGlobalEnvironment"
        @edit-environment="editEnvironment('Global')"
      />
    </div>
    <EnvironmentsMy @select-environment="handleEnvironmentChange" />
    <EnvironmentsMyDetails
      :show="showModalDetails"
      :action="action"
      :editing-environment-index="editingEnvironmentIndex"
      :editing-variable-name="editingVariableName"
      :env-vars="envVars"
      :is-secret-option-selected="secretOptionSelected"
      @hide-modal="displayModalEdit(false)"
    />
    <EnvironmentsAdd
      :show="showModalNew"
      :name="editingVariableName"
      :value="editingVariableValue"
      :position="position"
      @hide-modal="displayModalNew(false)"
    />
  </div>

  <HoppSmartConfirmModal
    :show="showConfirmRemoveEnvModal"
    :title="`${t('confirm.remove_environment')}`"
    @hide-modal="showConfirmRemoveEnvModal = false"
    @resolve="removeSelectedEnvironment()"
  />
</template>

<script setup lang="ts">
import { useReadonlyStream, useStream } from "@composables/stream"
import { Environment, GlobalEnvironment } from "@hoppscotch/data"
import { cloneDeep } from "lodash-es"
import { computed, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { defineActionHandler } from "~/helpers/actions"
import {
  createEnvironment,
  deleteEnvironment,
  environmentsStore,
  getGlobalVariables,
  getSelectedEnvironmentIndex,
  globalEnv$,
  selectedEnvironmentIndex$,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import { getService } from "~/modules/dioc"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { CurrentValueService } from "~/services/current-environment-value.service"

const t = useI18n()
const toast = useToast()

const globalEnv = useReadonlyStream(globalEnv$, {
  v: 2,
  variables: [],
} as GlobalEnvironment)

const globalEnvironment = computed<Environment>(() => ({
  v: 2 as const,
  id: "Global",
  name: "Global",
  variables: globalEnv.value.variables,
}))

const selectedEnvironmentIndex = useStream(
  selectedEnvironmentIndex$,
  { type: "NO_ENV_SELECTED" },
  setSelectedEnvironmentIndex
)

const showConfirmRemoveEnvModal = ref(false)
const showModalNew = ref(false)
const showModalDetails = ref(false)
const action = ref<"new" | "edit">("edit")
const editingEnvironmentIndex = ref<"Global" | null>(null)
const editingVariableName = ref("")
const editingVariableValue = ref("")
const secretOptionSelected = ref(false)
const duplicateGlobalEnvironmentLoading = ref(false)

const position = ref({ top: 0, left: 0 })

const displayModalNew = (shouldDisplay: boolean) => {
  showModalNew.value = shouldDisplay
}

const displayModalEdit = (shouldDisplay: boolean) => {
  action.value = "edit"
  showModalDetails.value = shouldDisplay

  if (!shouldDisplay) resetSelectedData()
}

const handleEnvironmentChange = ({ index }: { index: number }) => {
  selectedEnvironmentIndex.value = {
    type: "MY_ENV",
    index,
  }
}

const editEnvironment = (environmentIndex: "Global") => {
  editingEnvironmentIndex.value = environmentIndex
  action.value = "edit"
  editingVariableName.value = ""
  displayModalEdit(true)
}

const duplicateGlobalEnvironment = async () => {
  createEnvironment(
    `Global - ${t("action.duplicate")}`,
    cloneDeep(getGlobalVariables())
  )

  toast.success(`${t("environment.duplicated")}`)
}

const secretEnvironmentService = getService(SecretEnvironmentService)
const currentEnvironmentValueService = getService(CurrentValueService)

const removeSelectedEnvironment = () => {
  const selectedEnvIndex = getSelectedEnvironmentIndex()
  if (selectedEnvIndex?.type === "NO_ENV_SELECTED") return

  if (selectedEnvIndex?.type === "MY_ENV") {
    // Pass envID so the selfhost sync handler can call the backend delete
    // for already-synced envs. The handler internally guards against the
    // create-window race (`pendingTempEnvIds` set in `sync.ts`) so a temp
    // `uniqueID()` here won't 404; only real backend ids reach the wire.
    const envID =
      environmentsStore.value.environments[selectedEnvIndex.index]?.id
    deleteEnvironment(selectedEnvIndex.index, envID)
    if (envID) {
      secretEnvironmentService.deleteSecretEnvironment(envID)
      currentEnvironmentValueService.deleteEnvironment(envID)
    }
    toast.success(`${t("state.deleted")}`)
  }
}

const resetSelectedData = () => {
  editingEnvironmentIndex.value = null
  editingVariableName.value = ""
  editingVariableValue.value = ""
  secretOptionSelected.value = false
}

defineActionHandler("modals.environment.new", () => {
  action.value = "new"
  showModalDetails.value = true
})

defineActionHandler("modals.environment.delete-selected", () => {
  showConfirmRemoveEnvModal.value = true
})

const additionalVars = ref<Environment["variables"]>([])

const envVars = () => [...globalEnv.value.variables, ...additionalVars.value]

defineActionHandler(
  "modals.global.environment.update",
  ({ variables, isSecret }) => {
    if (variables) {
      additionalVars.value = variables
    }
    secretOptionSelected.value = isSecret ?? false
    editEnvironment("Global")
    editingVariableName.value = "Global"
  }
)

defineActionHandler("modals.environment.add", ({ envName, variableName }) => {
  editingVariableName.value = envName
  editingVariableValue.value = variableName ?? ""
  displayModalNew(true)
})
</script>
