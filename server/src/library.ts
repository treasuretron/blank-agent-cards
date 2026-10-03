import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SAVED_CARD_FORMAT, SavedCardMetaSchema, SavedCardNameSchema, savedCardName, type Card, type SavedCardMeta } from '@cards/shared'

// The server-side card library: one directory of <name>.png + <name>.json pairs,
// shared by every room on this server. A card is listed only once both halves exist.
export class Library {
  constructor(readonly directory: string, readonly maxCards = 1000) {}

  async list(): Promise<(SavedCardMeta & { name: string })[]> {
    await mkdir(this.directory, { recursive: true })
    const files = new Set(await readdir(this.directory))
    const cards: (SavedCardMeta & { name: string })[] = []
    for (const file of files) {
      const name = file.slice(0, -'.json'.length)
      if (!file.endsWith('.json') || !SavedCardNameSchema.safeParse(name).success || !files.has(`${name}.png`)) continue
      const meta = SavedCardMetaSchema.safeParse(JSON.parse(await readFile(path.join(this.directory, file), 'utf8').catch(() => 'null')))
      if (meta.success) cards.push({ ...meta.data, name })
    }
    return cards.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async save(card: Card, authorName: string, gameCode: string): Promise<string> {
    const name = savedCardName(card)
    await mkdir(this.directory, { recursive: true })
    const files = new Set(await readdir(this.directory))
    if (files.has(`${name}.json`)) return name
    if ([...files].filter(f => f.endsWith('.json')).length >= this.maxCards) throw new Error('The server card library is full')
    const meta: SavedCardMeta = { format: SAVED_CARD_FORMAT, id: card.id, title: card.title, text: card.text, authorName, savedAt: new Date().toISOString(), gameCode }
    // Image first, metadata last: list() ignores a pair until its .json lands.
    await this.write(`${name}.png`, Buffer.from(card.png.slice('data:image/png;base64,'.length), 'base64'))
    await this.write(`${name}.json`, JSON.stringify(meta, null, 2) + '\n')
    return name
  }

  async read(name: string): Promise<{ meta: SavedCardMeta; png: Buffer } | null> {
    if (!SavedCardNameSchema.safeParse(name).success) return null
    try {
      const meta = SavedCardMetaSchema.parse(JSON.parse(await readFile(path.join(this.directory, `${name}.json`), 'utf8')))
      return { meta, png: await readFile(path.join(this.directory, `${name}.png`)) }
    } catch { return null }
  }

  private async write(file: string, data: string | Buffer) {
    const target = path.join(this.directory, file)
    await writeFile(`${target}.tmp`, data, { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }
}
