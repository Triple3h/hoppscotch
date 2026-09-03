import { BackendPlatformDef } from "~/platform/backend"

// No-op backend platform: the app is fully local and never contacts a backend.
export const def: BackendPlatformDef = {}
