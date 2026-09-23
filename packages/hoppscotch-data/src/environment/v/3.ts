import { z } from "zod"
import { defineVersion } from "verzod"
import { V2_SCHEMA } from "./2"

export const V3_SCHEMA = V2_SCHEMA.extend({
  v: z.literal(3),
  // Swatch picked in the environment editor, stored as a hex string.
  // Absent means "no colour", falling back to the theme's default surface.
  color: z.string().optional(),
})

export default defineVersion({
  initial: false,
  schema: V3_SCHEMA,
  up(old: z.infer<typeof V2_SCHEMA>) {
    const result: z.infer<typeof V3_SCHEMA> = {
      ...old,
      v: 3,
    }

    return result
  },
})
