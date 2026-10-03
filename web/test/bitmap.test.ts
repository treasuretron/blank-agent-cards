import assert from "node:assert/strict"
import { test } from "node:test"
import {
  INK,
  PAPER,
  artSize,
  cloneBitmap,
  createBitmap,
  dither,
  fitContain,
  grayscale,
  isBlank,
  otsuThreshold,
  stampDisc,
  strokeSegment,
  threshold,
  toRGBA,
} from "../lib/bitmap.ts"

test("eraser writes paper over ink", () => {
  const bm = createBitmap(20, 20)
  stampDisc(bm, 10, 10, 5, INK)
  assert.equal(bm.ink[10 * 20 + 10], INK)
  stampDisc(bm, 10, 10, 8, PAPER)
  assert.ok(isBlank(bm))
})

test("strokes are continuous and clipped to the bitmap", () => {
  const bm = createBitmap(50, 10)
  strokeSegment(bm, -10, 5, 60, 5, 1, INK)
  for (let x = 0; x < 50; x++) assert.equal(bm.ink[5 * 50 + x], INK, `gap at x=${x}`)
})

test("rgba output is opaque pure black and white", () => {
  const bm = createBitmap(4, 1)
  bm.ink[1] = INK
  const rgba = toRGBA(bm)
  assert.deepEqual([...rgba], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
})

test("transparent import pixels become paper", () => {
  const gray = grayscale([0, 0, 0, 0, 0, 0, 0, 255], 2, 1)
  assert.deepEqual([...gray], [255, 0])
  const bm = threshold(gray, 2, 1, 128)
  assert.deepEqual([...bm.ink], [PAPER, INK])
})

test("otsu separates two tone clusters", () => {
  const gray = new Uint8Array([...Array(50).fill(40), ...Array(50).fill(200)])
  const t = otsuThreshold(gray)
  assert.ok(t > 40 && t <= 200, `threshold ${t}`)
  const bm = threshold(gray, 100, 1, t)
  assert.equal(bm.ink.filter((v) => v === INK).length, 50)
})

test("dither of mid-grey yields roughly half ink and only 0/1", () => {
  const gray = new Uint8Array(64 * 64).fill(128)
  const bm = dither(gray, 64, 64, 128)
  const ink = bm.ink.filter((v) => v === INK).length
  assert.ok(ink > 64 * 64 * 0.4 && ink < 64 * 64 * 0.6, `ink ${ink}`)
  assert.ok(bm.ink.every((v) => v === INK || v === PAPER))
})

test("fitContain letterboxes without cropping", () => {
  assert.deepEqual(fitContain(1000, 500, 480, 480), { x: 0, y: 120, w: 480, h: 240 })
  assert.deepEqual(fitContain(100, 400, 480, 480), { x: 180, y: 0, w: 120, h: 480 })
})

test("clone is independent and art is square at card width", () => {
  const a = createBitmap(3, 3)
  const b = cloneBitmap(a)
  b.ink[0] = INK
  assert.equal(a.ink[0], PAPER)
  assert.deepEqual(artSize({ widthPx: 480, heightPx: 720 }), { width: 480, height: 480 })
})
