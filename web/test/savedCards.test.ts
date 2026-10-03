import assert from "node:assert/strict"
import { deflateRawSync } from "node:zlib"
import { test } from "node:test"
import { crc32, createZip, readZip } from "../lib/zip.ts"
import { pairSavedFiles, pngDataUrl, savedCardEntries, savedCardMeta } from "../lib/savedCards.ts"

const card = { id: "0d4c1a62-0000-4000-8000-000000000000", authorId: "a", title: "Steal It!", text: "Take 5 points", imageUrl: "" }
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
})

test("zip round-trips stored entries", async () => {
  const entries = savedCardEntries(card, savedCardMeta(card, "Trav", "ABCD"), png)
  assert.deepEqual(entries.map((e) => e.name), [`steal-it--${card.id}.png`, `steal-it--${card.id}.json`])
  const back = await readZip(createZip(entries))
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name))
  assert.deepEqual([...back[0].data], [...png])
})

test("zip reader inflates deflated entries from OS-made zips", async () => {
  const text = new TextEncoder().encode("hello hello hello hello")
  const zip = createZip([{ name: "a.txt", data: deflateRawSync(text) }])
  // Mark the entry as deflated (method 8) in both the local and central headers.
  const view = new DataView(zip.buffer)
  view.setUint16(8, 8, true)
  view.setUint16(zip.length - 22 - 46 - 5 + 10, 8, true)
  const [entry] = await readZip(zip)
  assert.equal(new TextDecoder().decode(entry.data), "hello hello hello hello")
})

test("pairs png+json by base name and reports orphans and bad metadata", () => {
  const [p, j] = savedCardEntries(card, savedCardMeta(card, "Trav", "ABCD"), png)
  const { pairs, errors } = pairSavedFiles([
    { name: `cards/${p.name}`, data: p.data },
    { name: `cards/${j.name}`, data: j.data },
    { name: "__MACOSX/cards/._x.png", data: png },
    { name: ".DS_Store", data: png },
    { name: "lonely.png", data: png },
    { name: "bad.png", data: png },
    { name: "bad.json", data: new TextEncoder().encode("{}") },
    { name: "notes.txt", data: png },
  ])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].meta.title, "Steal It!")
  assert.equal(pairs[0].meta.authorName, "Trav")
  assert.deepEqual(errors.sort(), ["bad.json is not a saved card", "lonely.png has no matching .json", "notes.txt: not a .png or .json"])
})

test("png bytes become a data URL", () => {
  assert.equal(pngDataUrl(png), `data:image/png;base64,${Buffer.from(png).toString("base64")}`)
})
