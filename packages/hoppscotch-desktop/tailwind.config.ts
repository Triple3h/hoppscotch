import { Config } from "tailwindcss"
import preset from "@hoppscotch/ui/ui-preset"

export default {
  content: ["src/**/*.{vue,html}"],
  presets: [preset],
  theme: {
    extend: {
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.25rem",
        "2xl": "1.5rem",
      },
    },
  },
} satisfies Config
