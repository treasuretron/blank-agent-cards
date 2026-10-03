"use client"

import type { RoomSnapshot } from "@cards/shared"
import styles from "./game.module.css"

const KNOWN: Record<string, string> = {
  targetScore: "points to win",
  direction: "turn direction",
  cardsPerTurn: "cards per turn",
  drawAfterPlay: "draw after playing",
  handSize: "hand size",
}

function show(v: unknown): string {
  if (typeof v === "string") return v
  return JSON.stringify(v)
}

// The live ruleset. Cards rewrite it, so anything beyond the known keys is a
// mechanic some card invented.
export function RulesPanel({ snap }: { snap: RoomSnapshot }) {
  const rules = snap.rules
  if (!rules) return null
  const { notes, ...fields } = rules
  const invented = Object.entries(fields).filter(([k]) => !(k in KNOWN))
  return (
    <section aria-label="Rules">
      <h2 className={styles.h2}>
        Rules <span className={styles.sub}>engine v{snap.engineVersion}</span>
      </h2>
      <dl className={styles.rules}>
        {Object.entries(KNOWN).map(([k, label]) => (
          <div key={k}>
            <dt>{label}</dt>
            <dd>{k === "direction" ? (rules.direction === 1 ? "forward" : "reversed") : show(fields[k])}</dd>
          </div>
        ))}
        {invented.map(([k, v]) => (
          <div key={k} className={styles.invented}>
            <dt>{k}</dt>
            <dd>{show(v)}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ol className={styles.notes}>
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ol>
      )}
    </section>
  )
}
