import { platform } from "~/platform"

let initialized = false

export function initializeApp() {
  if (!initialized) {
    try {
      platform.auth.performAuthInit()
      platform.analytics?.initAnalytics()

      initialized = true
    } catch (_e) {
      // initializeApp throws exception if we reinitialize
      initialized = true
    }
  }
}
