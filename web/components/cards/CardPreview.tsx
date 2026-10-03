"use client"

import { useLayoutEffect, useRef } from "react"
import styles from "./cards.module.css"

// Approximation of the server-composited card, shown while authoring. The
// server's composite is authoritative; this only previews the layout.
export function CardPreview({ title, text, art, aspect }: { title: string; text: string; art: string | null; aspect: string }) {
  // Like the server, shrink long text until it fits the space under the art.
  const textRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    let size = 0.95
    el.style.fontSize = `${size}rem`
    while (size > 0.5 && el.scrollHeight > el.clientHeight) el.style.fontSize = `${(size -= 0.05)}rem`
  }, [text, title, art, aspect])
  return (
    <div className={styles.preview} style={{ aspectRatio: aspect }} aria-label="Card preview">
      <div className={styles.previewTitle}>{title}</div>
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URL
        <img className={styles.previewArt} src={art} alt="" />
      ) : (
        <div className={styles.previewArt} />
      )}
      <div ref={textRef} className={styles.previewText}>{text}</div>
    </div>
  )
}
