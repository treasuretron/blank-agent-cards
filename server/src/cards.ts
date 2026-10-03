import { createCanvas, loadImage, GlobalFonts, type Canvas } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import { cardDraftSchema, type CardDraft, type GameConfig } from '@cards/shared'

GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/PatrickHand-Regular.ttf', import.meta.url)), 'Patrick Hand')

export async function composeCard(raw: CardDraft, config: GameConfig['card']) {
  const draft = cardDraftSchema(config).parse(raw)
  const bytes = pngBytes(draft.art, 3_000_000)
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width > config.widthPx || height > config.heightPx) throw new Error('Art exceeds card dimensions')
  const image = await loadImage(bytes)
  if (image.width !== width || image.height !== height) throw new Error('PNG dimensions mismatch')
  const canvas = createCanvas(config.widthPx, config.heightPx)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const padding = Math.max(8, Math.round(canvas.width * .04))
  const titleSize = Math.round(canvas.width * .065), textSize = Math.round(canvas.width * .048)
  const artTop = padding + titleSize * 1.5, artHeight = canvas.height * .58
  ctx.drawImage(image, padding, artTop, canvas.width - padding * 2, artHeight)
  ctx.fillStyle = 'black'; ctx.textBaseline = 'top'; ctx.font = `${titleSize}px "Patrick Hand"`
  ctx.fillText(draft.title ?? '', padding, padding, canvas.width - padding * 2)
  ctx.font = `${textSize}px "Patrick Hand"`
  let y = artTop + artHeight + padding, line = ''
  for (const character of draft.text) {
    if (character === '\n' || ctx.measureText(line + character).width > canvas.width - padding * 2) {
      ctx.fillText(line, padding, y); y += textSize * 1.25; line = character === '\n' ? '' : character
    } else line += character
  }
  ctx.fillText(line, padding, y)
  return oneBit(canvas)
}

// A previously saved card is already composited, so it is only re-encoded: it must
// be exactly card-sized, and every pixel is forced back to opaque black or white.
export async function normalizeSavedCard(png: string, config: GameConfig['card']) {
  const bytes = pngBytes(png, 3_000_000)
  if (bytes.readUInt32BE(16) !== config.widthPx || bytes.readUInt32BE(20) !== config.heightPx) throw new Error(`Saved card must be ${config.widthPx}x${config.heightPx}`)
  const image = await loadImage(bytes)
  if (image.width !== config.widthPx || image.height !== config.heightPx) throw new Error('PNG dimensions mismatch')
  const canvas = createCanvas(config.widthPx, config.heightPx)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0)
  return oneBit(canvas)
}

function pngBytes(dataUrl: string, maxLength: number) {
  const data = dataUrl.slice('data:image/png;base64,'.length)
  if (data.length > maxLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid or oversized PNG')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString() !== 'IHDR') throw new Error('Invalid PNG signature')
  return bytes
}

// Normalize all pixels, including anti-aliased text, to opaque black or white.
function oneBit(canvas: Canvas) {
  const ctx = canvas.getContext('2d')
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] < 384 ? 0 : 255
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
