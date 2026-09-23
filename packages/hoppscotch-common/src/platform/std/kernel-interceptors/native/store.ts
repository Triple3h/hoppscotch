import { Service } from "dioc"
import type { RelayRequest } from "@hoppscotch/kernel"
import { Store } from "~/kernel/store"
import * as E from "fp-ts/Either"
import {
  InputDomainSetting,
  convertDomainSetting,
} from "~/helpers/functional/domain-settings"
import {
  GLOBAL_DOMAIN,
  defaultDomainConfig,
  getMergedDomainSettings,
  buildStoredData,
  toStoredDomainSetting,
} from "~/helpers/functional/domain-settings-store"

const STORE_NAMESPACE = "interceptors.native.v1"

const STORE_KEYS = {
  SETTINGS: "settings",
} as const

interface StoredData {
  version: string
  domains: Record<string, InputDomainSetting>
  lastUpdated: string
}

export class KernelInterceptorNativeStore extends Service {
  public static readonly ID = "KERNEL_NATIVE_INTERCEPTOR_STORE"

  private domainSettings = new Map<string, InputDomainSetting>()

  async onServiceInit(): Promise<void> {
    const initResult = await Store.init()
    if (E.isLeft(initResult)) {
      console.error(
        "[NativeStore] Failed to initialize store:",
        initResult.left
      )
      return
    }

    await this.loadStore()
    this.setupWatchers()
  }

  private async loadStore(): Promise<void> {
    const loadResult = await Store.get<StoredData>(
      STORE_NAMESPACE,
      STORE_KEYS.SETTINGS
    )

    if (E.isRight(loadResult) && loadResult.right) {
      const storedData = loadResult.right
      this.domainSettings = new Map(Object.entries(storedData.domains))
    }

    if (!this.domainSettings.has(GLOBAL_DOMAIN)) {
      this.domainSettings.set(GLOBAL_DOMAIN, { ...defaultDomainConfig })
      await this.persistStore()
    }
  }

  private async setupWatchers() {
    const watcher = await Store.watch(STORE_NAMESPACE, STORE_KEYS.SETTINGS)
    watcher.on("change", async ({ value }) => {
      if (value) {
        const store = value as StoredData
        this.domainSettings = new Map(Object.entries(store.domains))
      }
    })
  }

  private async persistStore(): Promise<void> {
    const store: StoredData = buildStoredData(
      Object.fromEntries(this.domainSettings)
    )

    const saveResult = await Store.set(
      STORE_NAMESPACE,
      STORE_KEYS.SETTINGS,
      store
    )
    if (E.isLeft(saveResult)) {
      console.error("[NativeStore] Failed to save store:", saveResult.left)
    }
  }

  public completeRequest(
    request: Omit<RelayRequest, "proxy" | "security" | "meta">
  ): RelayRequest {
    const host = new URL(request.url).host
    const settings = getMergedDomainSettings(this.domainSettings, host)
    const effective = convertDomainSetting(settings)

    if (E.isLeft(effective)) {
      throw effective.left
    }

    return { ...request, ...effective.right }
  }

  public getDomainSettings(domain: string): InputDomainSetting {
    return this.domainSettings.get(domain) ?? { ...defaultDomainConfig }
  }

  public async saveDomainSettings(
    domain: string,
    settings: Partial<InputDomainSetting>
  ): Promise<void> {
    this.domainSettings.set(domain, toStoredDomainSetting(settings))
    await this.persistStore()
  }

  public async clearDomainSettings(domain: string): Promise<void> {
    this.domainSettings.delete(domain)
    await this.persistStore()
  }

  public getDomains(): string[] {
    return Array.from(this.domainSettings.keys())
  }

  public getAllDomainSettings(): Map<string, InputDomainSetting> {
    return new Map(this.domainSettings)
  }
}
