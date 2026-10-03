// 1-bit card art. Every pixel is ink (black) or paper (white); there is no
// alpha and no grey, so drawing and imports obey the same constraint and the
// server/agent see exactly what the author saw.

export type Bitmap = { width: number; height: number; ink: Uint8Array }

export const INK = 1
export const PAPER = 0

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, ink: new Uint8Array(width * height) }
}

export function cloneBitmap(bm: Bitmap): Bitmap {
  return { width: bm.width, height: bm.height, ink: bm.ink.slice() }
}

export function isBlank(bm: Bitmap): boolean {
  for (let i = 0; i < bm.ink.length; i++) if (bm.ink[i]) return false
  return true
}

// Paints a filled disc. The eraser is the same operation with PAPER: it
// writes white, it never makes pixels transparent.
export function stampDisc(bm: Bitmap, cx: number, cy: number, radius: number, value: number): void {
  const r = Math.max(0.5, radius)
  const r2 = r * r
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(bm.width - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(bm.height - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) bm.ink[y * bm.width + x] = value
    }
  }
}

// Stamps discs along a segment closely enough that the stroke has no gaps.
export function strokeSegment(
  bm: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  value: number,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(0.5, radius / 2)
  const steps = Math.max(1, Math.ceil(dist / step))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    stampDisc(bm, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, value)
  }
}

// Writes the bitmap as opaque black/white RGBA, ready for putImageData.
export function toRGBA(bm: Bitmap, out: Uint8ClampedArray = new Uint8ClampedArray(bm.width * bm.height * 4)): Uint8ClampedArray {
  for (let i = 0, p = 0; i < bm.ink.length; i++, p += 4) {
    const v = bm.ink[i] ? 0 : 255
    out[p] = v
    out[p + 1] = v
    out[p + 2] = v
    out[p + 3] = 255
  }
  return out
}

// Rec. 601 luma with alpha composited over white paper, so transparent
// regions of an imported PNG become white rather than black.
export function grayscale(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = rgba[p + 3] / 255
    const luma = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
    gray[i] = Math.round(luma * a + 255 * (1 - a))
  }
  return gray
}

// Otsu's method: the threshold that best separates the two tone classes.
// A reasonable default for photos and scans before the author adjusts it.
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 128
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t + 1
    }
  }
  return best
}

// Pixels darker than `cutoff` become ink.
export function threshold(gray: Uint8Array, width: number, height: number, cutoff: number): Bitmap {
  const bm = createBitmap(width, height)
  for (let i = 0; i < gray.length; i++) bm.ink[i] = gray[i] < cutoff ? INK : PAPER
  return bm
}

// Floyd–Steinberg error diffusion. Still strictly 1-bit output; it just keeps
// more of a photo's tone than a flat threshold does.
export function dither(gray: Uint8Array, width: number, height: number, cutoff: number): Bitmap {
  const bm = createBitmap(width, height)
  const buf = Float32Array.from(gray)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = buf[i]
      const ink = old < cutoff
      bm.ink[i] = ink ? INK : PAPER
      const err = old - (ink ? 0 : 255)
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16
        buf[i + width] += (err * 5) / 16
        if (x + 1 < width) buf[i + width + 1] += err / 16
      }
    }
  }
  return bm
}

// Largest rect with the source's aspect ratio that fits inside the target,
// centred. Imports are letterboxed on white, never cropped or stretched.
export function fitContain(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { x: Math.floor((dstW - w) / 2), y: Math.floor((dstH - h) / 2), w, h }
}

// Art occupies the full card width and a square region of it; the server
// composites the title above and the text below. See web/README.md.
export function artSize(card: { widthPx: number; heightPx: number }) {
  const side = Math.min(card.widthPx, card.heightPx)
  return { width: side, height: side }
}
