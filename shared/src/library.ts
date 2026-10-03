import { z } from "zod"

// Saved cards live as a pair of files sharing one base name:
//   <title-slug>--<cardId>.png   the composited card, text baked in
//   <title-slug>--<cardId>.json  SavedCardMeta
// The same pair is used for local downloads and the server library.
export const SAVED_CARD_FORMAT = 1

export const SavedCardNameSchema = z.string().regex(/^[a-z0-9-]{1,40}--[a-f0-9-]{36}$/)

export const SavedCardMetaSchema = z.object({
  format: z.literal(SAVED_CARD_FORMAT),
  id: z.string().uuid(),
  title: z.string().optional(),
  text: z.string(),
  authorName: z.string(),
  savedAt: z.string(),
  gameCode: z.string(),
})
export type SavedCardMeta = z.infer<typeof SavedCardMetaSchema>

export function slugify(title: string | undefined): string {
  const slug = (title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "")
  return slug || "untitled"
}

export function savedCardName(card: { id: string; title?: string }): string {
  return `${slugify(card.title)}--${card.id}`
}

// A card in the server library, as listed to players. Images are served by URL.
export type LibraryCard = { name: string; title?: string; text: string; authorName: string; imageUrl: string }
