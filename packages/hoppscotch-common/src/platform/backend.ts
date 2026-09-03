/**
 * Backend platform definition.
 *
 * All cloud-backed features (shortcodes, mock servers, published docs) have
 * been removed from this fork. The app is fully local and never talks to a
 * backend, so this interface is intentionally empty and the platform-level
 * backend slot is a no-op.
 */
export type BackendPlatformDef = Record<string, never>
