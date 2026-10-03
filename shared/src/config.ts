import { z } from "zod"

const ConfigFieldsSchema = z.object({
  maxPlayers: z.number().int().min(1),
  minPlayers: z.number().int().min(1),
  cardsPerPlayer: z.number().int().min(1),
  handSize: z.number().int().min(1),
  targetScore: z.number().int().positive(),
  card: z.object({
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    maxChars: z.number().int().positive(),
    titleMaxChars: z.number().int().positive(),
  }),
  agent: z.object({
    provider: z.enum(["mock", "opencode"]),
    model: z.string().min(1),
    maxRollbackRetries: z.number().int().min(0),
    timeoutMs: z.number().int().positive(),
  }),
  server: z.object({ port: z.number().int().positive().max(65535) }),
})
export const GameConfigSchema = ConfigFieldsSchema.superRefine((config, ctx) => {
  if (config.minPlayers > config.maxPlayers) {
    ctx.addIssue({ code: "custom", path: ["minPlayers"], message: "minPlayers must not exceed maxPlayers" })
  }
  if (config.handSize > config.cardsPerPlayer) {
    ctx.addIssue({ code: "custom", path: ["handSize"], message: "The shared deck must contain enough cards to deal every hand" })
  }
})
export type GameConfig = z.infer<typeof GameConfigSchema>

export const ConfigOverridesSchema = ConfigFieldsSchema.pick({
  minPlayers: true,
  maxPlayers: true,
  cardsPerPlayer: true,
  handSize: true,
  targetScore: true,
}).partial()
export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>
