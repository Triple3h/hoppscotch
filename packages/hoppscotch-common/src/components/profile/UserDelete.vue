<template>
  <section class="p-4">
    <h4 class="font-semibold text-secondaryDark">
      {{ deleteAccountLabel }}
    </h4>
    <div class="my-1 mb-4 text-secondaryLight">
      {{ deleteAccountDescription }}
    </div>
    <HoppButtonSecondary
      filled
      outline
      :label="t('settings.delete_account')"
      type="submit"
      @click="showDeleteAccountModal = true"
    />
    <HoppSmartModal
      v-if="showDeleteAccountModal"
      dialog
      :title="deleteAccountLabel"
      @close="showDeleteAccountModal = false"
    >
      <template #body>
        <div
          class="bg-bannerInfo mb-4 flex flex-col space-y-2 rounded-lg border border-red-500 p-4 text-secondaryDark"
        >
          <h2 class="font-bold text-red-500">
            {{ t("error.danger_zone") }}
          </h2>
          <div class="font-medium text-secondaryDark">
            {{ deleteAccountDescription }}
          </div>
        </div>
        <div class="flex flex-col">
          <input
            id="deleteUserAccount"
            v-model="userVerificationInput"
            class="input floating-input"
            placeholder=" "
            type="text"
            autocomplete="off"
          />
          <label for="deleteUserAccount">
            Type
            <span class="font-bold"> delete my account </span>
            to confirm
          </label>
        </div>
      </template>
      <template #footer>
        <span class="flex space-x-2">
          <HoppButtonPrimary
            :label="t('settings.delete_account')"
            :loading="deletingUser"
            filled
            outline
            :disabled="userVerificationInput !== 'delete my account'"
            class="!hover:bg-red-600 !hover:border-red-600 !border-red-500 !bg-red-500"
            @click="deleteUserAccount"
          />
          <HoppButtonSecondary
            :label="t('action.cancel')"
            outline
            filled
            @click="showDeleteAccountModal = false"
          />
        </span>
      </template>
    </HoppSmartModal>
  </section>
</template>

<script setup lang="ts">
import { pipe } from "fp-ts/function"
import * as TE from "fp-ts/TaskEither"
import { GQLError } from "~/helpers/backend/GQLClient"
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { deleteUser } from "~/helpers/backend/mutations/Profile"
import { platform } from "~/platform"

const t = useI18n()
const toast = useToast()
const router = useRouter()

const showDeleteAccountModal = ref(false)
const userVerificationInput = ref("")

const deleteAccountLabel = computed(() =>
  platform.organization
    ? t("organization.delete_account")
    : t("settings.delete_account")
)

const deleteAccountDescription = computed(() =>
  platform.organization
    ? t("organization.delete_account_description")
    : t("settings.delete_account_description")
)

const deletingUser = ref(false)

const deleteUserAccount = async () => {
  if (deletingUser.value) return
  deletingUser.value = true

  pipe(
    deleteUser(),
    TE.match(
      (err: GQLError<string>) => {
        deletingUser.value = false
        toast.error(getErrorMessage(err))
      },
      () => {
        deletingUser.value = false
        showDeleteAccountModal.value = false
        toast.success(t("settings.account_deleted"))
        platform.auth.signOutUser()
        router.push(`/`)
      }
    )
  )()
}

const getErrorMessage = (err: GQLError<string>) => {
  if (err.type === "network_error") {
    return t("error.network_error")
  }

  const { error } = err

  if (error.includes("user/is_sole_admin")) {
    return t("organization.user_deletion_failed_sole_admin")
  }

  if (error.includes("user/is_owner")) {
    return t("organization.user_deletion_failed_sole_team_owner")
  }

  return t("error.something_went_wrong")
}
</script>
