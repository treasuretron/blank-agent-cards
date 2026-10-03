import { SAVED_CARD_FORMAT, SavedCardMetaSchema, savedCardName, type CardView, type SavedCardMeta } from "@cards/shared"
import { createZip, readZip, type ZipEntry } from "./zip.ts"

// Local half of the saved-card convention (see shared/src/library.ts): a card is
// <name>.png + <name>.json. Several cards download as one zip of such pairs.

export type SavedPair = { name: string; png: Uint8Array; meta: SavedCardMeta }

export function savedCardMeta(card: CardView, authorName: string, gameCode: string): SavedCardMeta {
  return { format: SAVED_CARD_FORMAT, id: card.id, title: card.title, text: card.text, authorName, savedAt: new Date().toISOString(), gameCode }
}

export function savedCardEntries(card: CardView, meta: SavedCardMeta, png: Uint8Array): ZipEntry[] {
  const name = savedCardName(card)
  return [
    { name: `${name}.png`, data: png },
    { name: `${name}.json`, data: new TextEncoder().encode(JSON.stringify(meta, null, 2) + "\n") },
  ]
}

export function bundle(entries: ZipEntry[]): Uint8Array {
  return createZip(entries)
}

// Matches .png and .json files by base name, ignoring folders inside a zip and
// OS clutter. Anything without its other half, or with bad metadata, is reported.
export function pairSavedFiles(files: ZipEntry[]): { pairs: SavedPair[]; errors: string[] } {
  const groups = new Map<string, { png?: Uint8Array; json?: Uint8Array }>()
  const errors: string[] = []
  for (const file of files) {
    const base = file.name.split("/").pop() ?? ""
    if (!base || base.startsWith(".") || file.name.includes("__MACOSX/")) continue
    const match = base.match(/^(.*)\.(png|json)$/i)
    if (!match) { errors.push(`${base}: not a .png or .json`); continue }
    const group = groups.get(match[1]) ?? {}
    group[match[2].toLowerCase() as "png" | "json"] = file.data
    groups.set(match[1], group)
  }
  const pairs: SavedPair[] = []
  for (const [name, group] of groups) {
    if (!group.png) { errors.push(`${name}.json has no matching .png`); continue }
    if (!group.json) { errors.push(`${name}.png has no matching .json`); continue }
    let meta: SavedCardMeta
    try {
      meta = SavedCardMetaSchema.parse(JSON.parse(new TextDecoder().decode(group.json)))
    } catch {
      errors.push(`${name}.json is not a saved card`)
      continue
    }
    pairs.push({ name, png: group.png, meta })
  }
  return { pairs, errors }
}

export async function readSavedFiles(files: File[]): Promise<{ pairs: SavedPair[]; errors: string[] }> {
  const entries: ZipEntry[] = []
  const errors: string[] = []
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer())
    if (/\.zip$/i.test(file.name)) {
      try {
        entries.push(...(await readZip(data)))
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : "unreadable zip"}`)
      }
    } else entries.push({ name: file.name, data })
  }
  const paired = pairSavedFiles(entries)
  return { pairs: paired.pairs, errors: [...errors, ...paired.errors] }
}

export function pngDataUrl(png: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}

export function download(name: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
