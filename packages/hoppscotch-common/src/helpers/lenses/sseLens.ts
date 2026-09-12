import { defineAsyncComponent } from "vue"
import { Lens } from "./lenses"
import { isSSEContentType } from "../utils/contenttypes"

const sseLens: Lens = {
  lensName: "response.events",
  isSupportedContentType: isSSEContentType,
  renderer: "sse",
  rendererImport: defineAsyncComponent(
    () => import("~/components/lenses/renderers/SSELensRenderer.vue")
  ),
}

export default sseLens
