import { GQLError } from "../backend/GQLClient"

export const getEnvActionErrorMessage = (err: GQLError<string>) => {
  if (err.type === "network_error") {
    return "error.network_error"
  }

  switch (err.error) {
    case "Forbidden resource":
      return "profile.no_permission"
    default:
      return "error.something_went_wrong"
  }
}
