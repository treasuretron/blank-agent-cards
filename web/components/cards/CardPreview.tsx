"use client"

import styles from "./cards.module.css"

// Approximation of the server-composited card, shown while authoring. The
// server's composite is authoritative; this only previews the layout.
export function CardPreview({ title, text, art, aspect }: { title: string; text: string; art: string | null; aspect: string }) {
  return (
    <div className={styles.preview} style={{ aspectRatio: aspect }} aria-label="Card preview">
      <div className={styles.previewTitle}>{title}</div>
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URL
        <img className={styles.previewArt} src={art} alt="" />
      ) : (
        <div className={styles.previewArt} />
      )}
      <div className={styles.previewText}>{text}</div>
    </div>
  )
}
