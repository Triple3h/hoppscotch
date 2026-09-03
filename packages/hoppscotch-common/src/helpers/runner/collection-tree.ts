import { ComposerTranslation } from "vue-i18n"
import { GQLError } from "../backend/GQLClient"

export const getErrorMessage = (
  err: GQLError<string>,
  t: ComposerTranslation
) => {
  console.error(err)
  if (err.type === "network_error") {
    return t("error.network_error")
  }
  switch (err.error) {
    case "Forbidden resource":
      return t("profile.no_permission")
    default:
      return t("error.something_went_wrong")
  }
}
