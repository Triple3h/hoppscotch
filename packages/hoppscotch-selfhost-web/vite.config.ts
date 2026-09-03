import { defineConfig } from "vite"
import Vue from "@vitejs/plugin-vue"
import VueI18n from "@intlify/unplugin-vue-i18n/vite"
import Components from "unplugin-vue-components/vite"
import Icons from "unplugin-icons/vite"
import Pages from "vite-plugin-pages"
import Layouts from "vite-plugin-vue-layouts"
import IconResolver from "unplugin-icons/resolver"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import * as path from "path"
import Unfonts from "unplugin-fonts/vite"

export default defineConfig({
  envPrefix: process.env.HOPP_ALLOW_RUNTIME_ENV ? "VITE_BUILDTIME_" : "VITE_",
  envDir: path.resolve(__dirname, "../../"),
  // TODO: Migrate @hoppscotch/data to full ESM
  define: {
    // For 'util' polyfill required by dep of '@apidevtools/swagger-parser'
    "process.env": {},
    "process.platform": '"browser"',
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  publicDir: path.resolve(__dirname, "../hoppscotch-common/public"),
  build: {
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      maxParallelFileOps: 2,
    },
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      // Config files
      "tailwind.config.cjs": path.resolve(
        __dirname,
        "../hoppscotch-common/tailwind.config.cjs"
      ),
      "postcss.config.cjs": path.resolve(
        __dirname,
        "../hoppscotch-common/postcss.config.cjs"
      ),

      // TODO: Maybe leave ~ only for individual apps and not use on common
      // Common package aliases
      "~": path.resolve(__dirname, "../hoppscotch-common/src"),
      "@hoppscotch/common": "@hoppscotch/common/src",

      // Common (shared) modules (legacy - TODO: migrate these to @common/*)
      "@composables": path.resolve(
        __dirname,
        "../hoppscotch-common/src/composables"
      ),
      "@modules": path.resolve(__dirname, "../hoppscotch-common/src/modules"),
      "@services": path.resolve(__dirname, "../hoppscotch-common/src/services"),
      "@components": path.resolve(
        __dirname,
        "../hoppscotch-common/src/components"
      ),
      "@helpers": path.resolve(__dirname, "../hoppscotch-common/src/helpers"),
      "@platform": path.resolve(__dirname, "../hoppscotch-common/src/platform"),
      "@functional": path.resolve(
        __dirname,
        "../hoppscotch-common/src/helpers/functional"
      ),
      "@workers": path.resolve(__dirname, "../hoppscotch-common/src/workers"),

      // Application layer
      "@app/platform": path.resolve(__dirname, "./src/platform"),
      "@app/services": path.resolve(__dirname, "./src/services"),
      "@app/components": path.resolve(__dirname, "./src/components"),
      "@app/composables": path.resolve(__dirname, "./src/composables"),
      "@app/helpers": path.resolve(__dirname, "./src/helpers"),
      "@app/api": path.resolve(__dirname, "./src/api"),
      "@app/kernel": path.resolve(__dirname, "./src/kernel"),

      // Node.js polyfills
      stream: "stream-browserify",
      util: "util",
      querystring: "qs",
    },
    dedupe: ["vue"],
  },
  plugins: [
    Vue(),
    Pages({
      routeStyle: "nuxt",
      dirs: ["../hoppscotch-common/src/pages", "./src/pages"],
      importMode: "async",
    }),
    Layouts({
      layoutsDirs: "../hoppscotch-common/src/layouts",
      defaultLayout: "default",
    }),
    VueI18n({
      runtimeOnly: false,
      compositionOnly: true,
      include: [path.resolve(__dirname, "locales")],
    }),
    Components({
      dts: "../hoppscotch-common/src/components.d.ts",
      dirs: ["../hoppscotch-common/src/components"],
      directoryAsNamespace: true,
      resolvers: [
        IconResolver({
          prefix: "icon",
          customCollections: ["hopp", "auth", "brands"],
        }),
        (compName: string) => {
          if (compName.startsWith("Hopp"))
            return { name: compName, from: "@hoppscotch/ui" }
          else return undefined
        },
      ],
      types: [
        {
          from: "vue-tippy",
          names: ["Tippy"],
        },
      ],
    }),
    Icons({
      compiler: "vue3",
      customCollections: {
        hopp: FileSystemIconLoader("../hoppscotch-common/assets/icons"),
        auth: FileSystemIconLoader("../hoppscotch-common/assets/icons/auth"),
        brands: FileSystemIconLoader(
          "../hoppscotch-common/assets/icons/brands"
        ),
      },
    }),
    Unfonts({
      fontsource: {
        families: [
          {
            name: "Inter Variable",
            variables: ["variable-full"],
          },
          {
            name: "Material Symbols Rounded Variable",
            variables: ["variable-full"],
          },
          {
            name: "Roboto Mono Variable",
            variables: ["variable-full"],
          },
        ],
      },
    }),
  ],
})
