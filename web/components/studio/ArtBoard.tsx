"use client"

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from "react"
import {
  INK,
  PAPER,
  cloneBitmap,
  createBitmap,
  dither,
  fitContain,
  grayscale,
  isBlank,
  otsuThreshold,
  strokeSegment,
  threshold,
  toRGBA,
  type Bitmap,
} from "@/lib/bitmap"
import styles from "./studio.module.css"

export type ArtBoardHandle = {
  exportPng(): string
  reset(): void
}

type Tool = "pen" | "eraser"
type ImportMode = "threshold" | "dither"
type PendingImport = { gray: Uint8Array; mode: ImportMode; cutoff: number }

const SIZES = [2, 5, 10, 20] as const
const UNDO_LIMIT = 30

export function ArtBoard({
  width,
  height,
  onChange,
  ref,
}: {
  width: number
  height: number
  onChange?(blank: boolean): void
  ref?: Ref<ArtBoardHandle>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const bitmap = useRef<Bitmap>(createBitmap(width, height))
  const undo = useRef<Bitmap[]>([])
  const redo = useRef<Bitmap[]>([])
  const last = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [tool, setTool] = useState<Tool>("pen")
  const [size, setSize] = useState<number>(SIZES[1])
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const paint = useCallback(() => {
    frame.current = null
    const ctx = canvas.current?.getContext("2d")
    if (!ctx) return
    const img = ctx.createImageData(width, height)
    toRGBA(bitmap.current, img.data)
    ctx.putImageData(img, 0, 0)
  }, [width, height])

  const schedulePaint = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  // Held in a ref so an inline callback from the parent can't retrigger the
  // reset effect below and wipe the drawing.
  const onBlank = useRef(onChange)
  useEffect(() => {
    onBlank.current = onChange
  })

  const changed = useCallback(() => {
    schedulePaint()
    setHistory({ undo: undo.current.length, redo: redo.current.length })
    onBlank.current?.(isBlank(bitmap.current))
  }, [schedulePaint])

  const checkpoint = useCallback(() => {
    undo.current.push(cloneBitmap(bitmap.current))
    if (undo.current.length > UNDO_LIMIT) undo.current.shift()
    redo.current = []
  }, [])

  // A new size (config change) starts a fresh sheet.
  useEffect(() => {
    bitmap.current = createBitmap(width, height)
    undo.current = []
    redo.current = []
    setPending(null)
    changed()
  }, [width, height, changed])

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const doUndo = useCallback(() => {
    const prev = undo.current.pop()
    if (!prev) return
    redo.current.push(bitmap.current)
    bitmap.current = prev
    setPending(null)
    changed()
  }, [changed])

  const doRedo = useCallback(() => {
    const next = redo.current.pop()
    if (!next) return
    undo.current.push(bitmap.current)
    bitmap.current = next
    changed()
  }, [changed])

  const clear = useCallback(() => {
    if (isBlank(bitmap.current)) return
    checkpoint()
    bitmap.current = createBitmap(width, height)
    setPending(null)
    changed()
  }, [checkpoint, changed, width, height])

  useImperativeHandle(
    ref,
    () => ({
      exportPng() {
        const out = document.createElement("canvas")
        out.width = width
        out.height = height
        const ctx = out.getContext("2d")!
        const img = ctx.createImageData(width, height)
        toRGBA(bitmap.current, img.data)
        ctx.putImageData(img, 0, 0)
        return out.toDataURL("image/png")
      },
      reset() {
        bitmap.current = createBitmap(width, height)
        undo.current = []
        redo.current = []
        setPending(null)
        setImportError(null)
        changed()
      },
    }),
    [width, height, changed],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === "z" && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [doUndo, doRedo])

  // --- drawing ---

  function toArt(e: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    }
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    checkpoint()
    // Drawing over an import commits it at the current threshold.
    setPending(null)
    const p = toArt(e)
    last.current = p
    strokeSegment(bitmap.current, p.x, p.y, p.x, p.y, size, tool === "pen" ? INK : PAPER)
    schedulePaint()
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? []
    const events = coalesced.length ? coalesced : [e.nativeEvent]
    const value = tool === "pen" ? INK : PAPER
    for (const ev of events) {
      const p = toArt(ev)
      strokeSegment(bitmap.current, last.current.x, last.current.y, p.x, p.y, size, value)
      last.current = p
    }
    schedulePaint()
  }

  function onPointerUp() {
    if (!last.current) return
    last.current = null
    changed()
  }

  // --- import ---

  const applyImport = useCallback(
    (imp: PendingImport) => {
      bitmap.current = (imp.mode === "dither" ? dither : threshold)(imp.gray, width, height, imp.cutoff)
      changed()
    },
    [width, height, changed],
  )

  const importFile = useCallback(
    async (file: File) => {
      setImportError(null)
      if (!file.type.startsWith("image/")) {
        setImportError("That file isn't an image.")
        return
      }
      const url = URL.createObjectURL(file)
      try {
        const img = new Image()
        img.src = url
        await img.decode()
        if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image")
        const off = document.createElement("canvas")
        off.width = width
        off.height = height
        const ctx = off.getContext("2d", { willReadFrequently: true })!
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, width, height)
        const fit = fitContain(img.naturalWidth, img.naturalHeight, width, height)
        ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h)
        const gray = grayscale(ctx.getImageData(0, 0, width, height).data, width, height)
        checkpoint()
        const imp: PendingImport = { gray, mode: "threshold", cutoff: otsuThreshold(gray) }
        setPending(imp)
        applyImport(imp)
      } catch {
        setImportError("Couldn't read that image.")
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    [width, height, checkpoint, applyImport],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"))
      if (!file) return
      e.preventDefault()
      void importFile(file)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [importFile])

  function adjust(next: Partial<PendingImport>) {
    if (!pending) return
    const imp = { ...pending, ...next }
    setPending(imp)
    applyImport(imp)
  }

  return (
    <div className={styles.board}>
      <div className={styles.toolbar} role="toolbar" aria-label="Drawing tools">
        <button type="button" aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>pen</button>
        <button type="button" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>eraser</button>
        <span className={styles.sizes} role="group" aria-label="Brush size">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.sizeBtn}
              aria-pressed={size === s}
              aria-label={`Brush size ${s}`}
              onClick={() => setSize(s)}
            >
              <span className={styles.dot} style={{ width: Math.max(4, s * 1.2), height: Math.max(4, s * 1.2) }} />
            </button>
          ))}
        </span>
        <span className={styles.spacer} />
        <button type="button" onClick={doUndo} disabled={!history.undo} title="Undo (Ctrl+Z)">undo</button>
        <button type="button" onClick={doRedo} disabled={!history.redo} title="Redo (Ctrl+Shift+Z)">redo</button>
        <button type="button" onClick={clear}>clear</button>
        <button type="button" onClick={() => fileInput.current?.click()}>import…</button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) void importFile(file)
          }}
        />
      </div>

      <div
        className={`${styles.canvasWrap} ${dragOver ? styles.dragOver : ""}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void importFile(file)
        }}
      >
        <canvas
          ref={canvas}
          width={width}
          height={height}
          className={`${styles.canvas} ${tool === "eraser" ? styles.erasing : ""}`}
          aria-label="Card art. Draw with the pen, or drop or paste an image."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {importError && <p className={styles.warn} role="alert">{importError}</p>}

      {pending && (
        <div className={styles.importPanel}>
          <span>import:</span>
          <button type="button" aria-pressed={pending.mode === "threshold"} onClick={() => adjust({ mode: "threshold" })}>
            threshold
          </button>
          <button type="button" aria-pressed={pending.mode === "dither"} onClick={() => adjust({ mode: "dither" })}>
            dither
          </button>
          <label className={styles.slider}>
            darkness
            <input
              type="range"
              min={1}
              max={255}
              value={pending.cutoff}
              onChange={(e) => adjust({ cutoff: Number(e.target.value) })}
            />
          </label>
          <button type="button" onClick={() => setPending(null)}>done</button>
        </div>
      )}
      <p className={styles.hint}>Black ink only. Imports are converted to pure black &amp; white. Drop or paste an image to import.</p>
    </div>
  )
}
