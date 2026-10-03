"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { normalizeCode, useRoom } from "@/lib/room"
import styles from "./page.module.css"

// Minimal create/join entry so the studio is reachable. M3 owns the room
// experience and is free to restyle or replace this page.
export default function Home() {
  const room = useRoom()
  const router = useRouter()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  async function go(action: () => Promise<string>) {
    setBusy(true)
    try {
      const joined = await action()
      router.push(`/room/${joined}/studio`)
    } catch {
      // The provider surfaces the server's message in room.error.
    } finally {
      setBusy(false)
    }
  }

  const trimmed = name.trim()
  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    void go(() => room.createRoom(trimmed))
  }
  const onJoin = () => void go(() => room.joinRoom(code, trimmed))

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>1000 blank agent cards</h1>
      <p className={styles.tag}>Draw the cards. The deck decides the game. An agent rewrites the rules.</p>
      {room.error && (
        <div className="banner-error" role="alert">
          <span>{room.error}</span>
          <button type="button" onClick={room.clearError}>ok</button>
        </div>
      )}
      <form className={styles.form} onSubmit={onCreate}>
        <label>
          Your name
          <input type="text" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <button type="submit" className="primary" disabled={busy || !trimmed}>Create a room</button>
        <div className={styles.or}>or join one</div>
        <div className={styles.row}>
          <input
            type="text"
            className={styles.code}
            aria-label="Room code"
            placeholder="ABCD"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button type="button" disabled={busy || !trimmed || code.length !== 4} onClick={onJoin}>Join</button>
        </div>
      </form>
    </main>
  )
}
