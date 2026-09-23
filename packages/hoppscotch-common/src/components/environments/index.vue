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
import { openEnvironmentTab } from "~/helpers/tab/openEnvironmentTab"
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
  v: 3,
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
const editingVariableName = ref("")
const editingVariableValue = ref("")
const duplicateGlobalEnvironmentLoading = ref(false)

const position = ref({ top: 0, left: 0 })

const displayModalNew = (shouldDisplay: boolean) => {
  showModalNew.value = shouldDisplay
}

const handleEnvironmentChange = ({ index }: { index: number }) => {
  selectedEnvironmentIndex.value = {
    type: "MY_ENV",
    index,
  }
}

const editEnvironment = (environmentIndex: "Global") => {
  openEnvironmentTab({ isGlobal: environmentIndex === "Global" })
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

defineActionHandler("modals.environment.new", () => {
  openEnvironmentTab({ isNew: true })
})

defineActionHandler("modals.environment.delete-selected", () => {
  showConfirmRemoveEnvModal.value = true
})

defineActionHandler(
  "modals.global.environment.update",
  ({ variables, isSecret }) => {
    openEnvironmentTab({
      isGlobal: true,
      seedVariables: variables,
      selectedOption: isSecret ? "secret" : "variables",
      selectedVariableName: variables?.[0]?.key ?? null,
    })
  }
)

defineActionHandler("modals.environment.add", ({ envName, variableName }) => {
  editingVariableName.value = envName
  editingVariableValue.value = variableName ?? ""
  displayModalNew(true)
})
</script>
