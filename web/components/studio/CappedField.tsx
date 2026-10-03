"use client"

import styles from "./studio.module.css"

// Text input with a live counter and a hard cap. `maxLength` counts UTF-16
// code units, which is what the server's zod `.max()` counts, and the slice
// guards against anything that slips past it (IME, programmatic input).
export function CappedField({
  label,
  value,
  max,
  onChange,
  multiline,
  placeholder,
}: {
  label: string
  value: string
  max: number
  onChange(next: string): void
  multiline?: boolean
  placeholder?: string
}) {
  const left = max - value.length
  const counterClass =
    left <= 0 ? styles.counterFull : left <= Math.max(5, Math.round(max * 0.1)) ? styles.counterNear : styles.counter
  const common = {
    value,
    maxLength: max,
    placeholder,
    "aria-label": label,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value.slice(0, max)),
  }
  return (
    <label className={styles.field}>
      <span className={styles.fieldHead}>
        <span>{label}</span>
        <span className={counterClass} aria-live="polite">
          {value.length}/{max}
        </span>
      </span>
      {multiline ? <textarea rows={4} {...common} /> : <input type="text" {...common} />}
    </label>
  )
}
