import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { useToast } from "@composables/toast"
import { useService } from "dioc/vue"
import type { MockServer } from "~/helpers/backend/types/MockServer"
import { platform } from "~/platform"
import { uniqueID } from "~/helpers/utils/uniqueID"
import { restCollections$ } from "~/newstore/collections"
import {
  addEnvironmentVariable,
  createEnvironment,
  environments$,
  getSelectedEnvironmentIndex,
  updateEnvironmentVariable,
} from "~/newstore/environments"
import {
  addMockServer,
  mockServers$,
  updateMockServer as updateMockServerInStore,
  loadMockServers,
} from "~/newstore/mockServers"
import { CurrentValueService } from "~/services/current-environment-value.service"

/**
 * Picks which mock-server URL should be stored as the `mockUrl`
 * environment variable.
 *
 * Policy: always prefer the subdomain-based URL
 * (`serverUrlDomainBased`) when it's available and fall back to the
 * path-based URL (`serverUrlPathBased`) otherwise. The backend only
 * returns `serverUrlDomainBased` when a wildcard domain is configured,
 * so the path-based URL is the universal fallback. On the cloud
 * instance only `serverUrlDomainBased` is returned, so that URL is
 * used there.
 */
function pickMockUrl(
  server: Pick<MockServer, "serverUrlPathBased" | "serverUrlDomainBased">
): string {
  const path = server.serverUrlPathBased ?? ""
  const subdomain = server.serverUrlDomainBased ?? ""
  return subdomain || path
}

export function useMockServer() {
  const t = useI18n()
  const toast = useToast()
  const currentValueService = useService(CurrentValueService)

  const mockServers = useReadonlyStream(mockServers$, [])
  const collections = useReadonlyStream(restCollections$, [])

  // Environment management
  const myEnvironments = useReadonlyStream(environments$, [])

  // Function to refetch mock servers
  const refetchData = async () => {
    try {
      // Refetch mock servers
      await loadMockServers()
    } catch (error) {
      console.error("Failed to refetch data:", error)
    }
  }

  // Function to add mock URL to environment
  const addMockUrlToEnvironment = async (
    mockUrl: string,
    collectionName: string
  ) => {
    // For personal workspace, add to selected environment or create new one.
    //
    // Architectural note: env variables are split into a persisted half
    // (`initialValue`, goes to the store / backend) and a local half
    // (`currentValue`, stored only in CurrentValueService). The persisted
    // payload must always carry `currentValue: ""`; the real value is
    // registered separately via `currentValueService`.
    const selectedEnvIndex = getSelectedEnvironmentIndex()

    if (selectedEnvIndex.type === "MY_ENV") {
      // Check if mockUrl already exists in the environment
      const env = myEnvironments.value[selectedEnvIndex.index]
      const existingVariableIndex = env.variables.findIndex(
        (v) => v.key === "mockUrl"
      )

      if (existingVariableIndex === -1) {
        // Add to existing selected environment. The new variable will be
        // appended at `env.variables.length` once the dispatch lands.
        const newVarIndex = env.variables.length
        addEnvironmentVariable(selectedEnvIndex.index, {
          key: "mockUrl",
          initialValue: mockUrl,
          currentValue: "",
          secret: false,
        })
        currentValueService.addEnvironmentVariable(env.id, {
          key: "mockUrl",
          currentValue: mockUrl,
          varIndex: newVarIndex,
          isSecret: false,
        })
        toast.success(t("mock_server.environment_variable_added"))
      } else {
        // Update existing mockUrl variable with new value using the
        // store dispatcher. Persist initial only; update the current
        // value separately via the service (remove + add, since there
        // is no explicit update API on the service).
        updateEnvironmentVariable(
          selectedEnvIndex.index,
          existingVariableIndex,
          {
            key: "mockUrl",
            initialValue: mockUrl,
            currentValue: "",
          }
        )
        currentValueService.removeEnvironmentVariable(
          env.id,
          existingVariableIndex
        )
        currentValueService.addEnvironmentVariable(env.id, {
          key: "mockUrl",
          currentValue: mockUrl,
          varIndex: existingVariableIndex,
          isSecret: false,
        })
        toast.success(t("mock_server.environment_variable_updated"))
      }
    } else {
      // Create a new environment with the mock URL.
      // We generate the env ID up front so we can register the current
      // value against the same ID without racing the dispatch.
      const envName = `${collectionName} Environment`
      const envID = uniqueID()
      createEnvironment(
        envName,
        [
          {
            key: "mockUrl",
            initialValue: mockUrl,
            currentValue: "",
            secret: false,
          },
        ],
        envID
      )
      currentValueService.addEnvironment(envID, [
        {
          key: "mockUrl",
          currentValue: mockUrl,
          varIndex: 0,
          isSecret: false,
        },
      ])
      toast.success(t("mock_server.environment_created_with_variable"))
    }
  }

  // Create new mock server
  const createMockServer = async (params: {
    mockServerName: string
    collectionID?: string
    autoCreateCollection?: boolean
    autoCreateRequestExample?: boolean
    delayInMs: number
    isPublic: boolean
    setInEnvironment: boolean
    collectionName: string
  }) => {
    const {
      mockServerName,
      collectionID,
      autoCreateCollection,
      autoCreateRequestExample,
      delayInMs,
      isPublic,
      setInEnvironment,
      collectionName,
    } = params

    if (!mockServerName.trim()) {
      return { success: false, server: null }
    }

    // Exactly one of collectionID or autoCreateCollection must be provided (XOR)
    if (
      (!collectionID && !autoCreateCollection) ||
      (collectionID && autoCreateCollection)
    ) {
      toast.error(t("mock_server.select_collection_error"))
      return { success: false, server: null }
    }

    // Create mock server in the personal workspace
    const result = await pipe(
      platform.backend.createMockServer(
        mockServerName.trim(),
        undefined,
        undefined,
        delayInMs,
        isPublic,
        collectionID,
        autoCreateCollection,
        autoCreateRequestExample
      ),
      TE.match(
        (error) => {
          toast.error(String(error) || t("error.something_went_wrong"))
          return null as MockServer | null
        },
        (result) => {
          toast.success(t("mock_server.mock_server_created"))
          // Add the new mock server to the store
          addMockServer(result)
          return result as MockServer
        }
      )
    )()

    if (!result) {
      return { success: false, server: null }
    }

    // Add mock URL to environment if enabled.
    // Always prefer `serverUrlDomainBased`; fall back to
    // `serverUrlPathBased` when the backend has no wildcard domain
    // configured and the subdomain URL comes back null.
    if (setInEnvironment) {
      const mockUrl = pickMockUrl(result)
      if (mockUrl) {
        await addMockUrlToEnvironment(mockUrl, collectionName)
      }
    }

    // Refetch collections and mock servers to get the latest data
    await refetchData()

    return { success: true, server: result }
  }

  // Toggle mock server active state
  const toggleMockServer = async (mockServer: MockServer) => {
    const newActiveState = !mockServer.isActive

    return await pipe(
      platform.backend.updateMockServer(mockServer.id, {
        isActive: newActiveState,
      }),
      TE.match(
        () => {
          toast.error(t("error.something_went_wrong"))
          return { success: false }
        },
        () => {
          toast.success(
            newActiveState
              ? t("mock_server.server_started")
              : t("mock_server.server_stopped")
          )

          // Update the mock server in the store
          updateMockServerInStore(mockServer.id, { isActive: newActiveState })

          return { success: true }
        }
      )
    )()
  }

  return {
    // State
    mockServers,
    availableCollections: collections,

    // Functions
    createMockServer,
    toggleMockServer,
    addMockUrlToEnvironment,
  }
}
