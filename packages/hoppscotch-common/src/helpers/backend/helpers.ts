import {
  CollectionVariable,
  HoppCollectionVariable,
  HoppRESTAuth,
  HoppRESTHeaders,
} from "@hoppscotch/data"
import { z } from "zod"

export type CollectionDataProps = {
  auth: HoppRESTAuth
  headers: HoppRESTHeaders
  variables: HoppCollectionVariable[]
  description: string | null
  preRequestScript: string
  testScript: string
  // Stable local-store key, round-tripped via `data._ref_id`. The wire
  // payload is opaque to the backend, which just echoes it back; the FE
  // uses it to pair populated secret-store entries to the backend `id`
  // or to migrate from `_ref_id` to backend `id` on collection import.
  _ref_id?: string
}

export const BACKEND_PAGE_SIZE = 10

// Pick the value from the parsed result if it is successful, otherwise, return the default value
const parseWithDefaultValue = <T>(
  parseResult: z.SafeParseReturnType<T, T>,
  defaultValue: T
): T => (parseResult.success ? parseResult.data : defaultValue)

// Parse the incoming value for the `data` (authorization/headers) field and obtain the value in the expected format
export const parseCollectionData = (
  data: string | Record<string, unknown> | null
): CollectionDataProps => {
  const defaultDataProps: CollectionDataProps = {
    auth: { authType: "inherit", authActive: true },
    headers: [],
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
  }

  if (!data) {
    return defaultDataProps
  }

  let parsedData: CollectionDataProps | Record<string, unknown> | null

  if (typeof data === "string") {
    try {
      parsedData = JSON.parse(data)
    } catch {
      return defaultDataProps
    }
  } else {
    parsedData = data
  }

  const auth = parseWithDefaultValue<CollectionDataProps["auth"]>(
    HoppRESTAuth.safeParse(parsedData?.auth),
    defaultDataProps.auth
  )

  const headers = parseWithDefaultValue<CollectionDataProps["headers"]>(
    HoppRESTHeaders.safeParse(parsedData?.headers),
    defaultDataProps.headers
  )

  const variables = parseWithDefaultValue<CollectionDataProps["variables"]>(
    z.array(CollectionVariable).safeParse(parsedData?.variables),
    defaultDataProps.variables
  )

  const description =
    typeof parsedData?.description === "string"
      ? parsedData.description
      : defaultDataProps.description

  const preRequestScript =
    typeof parsedData?.preRequestScript === "string"
      ? parsedData.preRequestScript
      : defaultDataProps.preRequestScript

  const testScript =
    typeof parsedData?.testScript === "string"
      ? parsedData.testScript
      : defaultDataProps.testScript

  return {
    auth,
    headers,
    variables,
    description,
    preRequestScript,
    testScript,
  }
}
