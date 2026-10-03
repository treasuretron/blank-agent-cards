"use client"

import type { RoomSnapshot } from "@cards/shared"
import Link from "next/link"
import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useRoom } from "@/lib/room"
import styles from "./room.module.css"

// Renders `children` once this tab holds a seat in `code` and has a snapshot.
// Otherwise resumes a stored seat, or offers to join (e.g. from a shared link).
export function RoomGate({ code, children }: { code: string; children(snap: RoomSnapshot): ReactNode }) {
  const room = useRoom()
  const [seated, setSeated] = useState<boolean | null>(null)
  const { resume } = room

  useEffect(() => {
    setSeated(resume(code))
  }, [code, resume])

  const snap = room.snapshot?.code === code ? room.snapshot : null
  if (seated === null) return null
  if (snap) return children(snap)
  // No seat for this code, or the server rejected our token.
  if (!seated || room.error) return <JoinHere code={code} onJoined={() => setSeated(true)} />
  return <main className={styles.center}>Connecting to room {code}…</main>
}

function JoinHere({ code, onJoined }: { code: string; onJoined(): void }) {
  const room = useRoom()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await room.joinRoom(code, name.trim())
      onJoined()
    } catch {
      // shown via room.error
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className={styles.center}>
      <form className={styles.joinForm} onSubmit={submit}>
        <h1>Join room {code}</h1>
        {room.error && <p role="alert">{room.error}</p>}
        <input type="text" aria-label="Your name" placeholder="Your name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>Join</button>
        <Link href="/">back</Link>
      </form>
    </main>
  )
}

export function RoomCode({ code, path }: { code: string; path: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.roomCode}>
      room <strong>{code}</strong>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}/room/${code}/${path}`).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? "copied!" : "copy link"}
      </button>
    </div>
  )
}
