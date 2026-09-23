import type { InputDomainSetting } from "./domain-settings"

// ponytail: pure helpers shared by the agent/native interceptor stores —
// no base class; agent-only auth fields stay in the agent store.

export const GLOBAL_DOMAIN = "*"

export const defaultDomainConfig: InputDomainSetting = {
  version: "v1",
  security: {
    verifyHost: true,
    verifyPeer: true,
  },
  proxy: undefined,
  options: {
    followRedirects: true,
  },
}

const mergeParts = <T extends object>(
  ...settings: (T | undefined)[]
): T | undefined =>
  settings.reduce<T | undefined>(
    (acc, setting) => (setting ? { ...acc, ...setting } : acc),
    undefined
  )

/**
 * Merge global then domain settings (domain wins on key conflicts),
 * matching the historical order used by agent/native stores.
 */
export const mergeDomainSettings = (
  globalSettings: InputDomainSetting | undefined,
  domainSettings: InputDomainSetting | undefined
): InputDomainSetting => ({
  version: "v1",
  security: mergeParts(globalSettings?.security, domainSettings?.security),
  proxy: mergeParts(globalSettings?.proxy, domainSettings?.proxy),
  options: mergeParts(globalSettings?.options, domainSettings?.options),
})

export const getMergedDomainSettings = (
  domainSettings: ReadonlyMap<string, InputDomainSetting>,
  domain: string
): InputDomainSetting => {
  const domainSetting = domainSettings.get(domain)
  const globalSetting =
    domain !== GLOBAL_DOMAIN ? domainSettings.get(GLOBAL_DOMAIN) : undefined
  return mergeDomainSettings(globalSetting, domainSetting)
}

export const toStoredDomainSetting = (
  settings: Partial<InputDomainSetting>
): InputDomainSetting => ({
  ...settings,
  version: "v1",
})

export const buildStoredData = (
  domains: Record<string, InputDomainSetting>
): {
  version: string
  domains: Record<string, InputDomainSetting>
  lastUpdated: string
} => ({
  version: "v1",
  domains,
  lastUpdated: new Date().toISOString(),
})
