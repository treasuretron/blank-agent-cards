"use client"

import type { ClientMsg, ConfigOverrides, LibraryCard, RoomSnapshot, ServerMsg } from "@cards/shared"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

// One websocket per browser tab, shared by every room page. Seat tokens are
// kept per room code so a refresh or reconnect resumes the same seat.

export type ConnStatus = "idle" | "connecting" | "open" | "closed"

type Seat = { token: string; playerId: string }

type RoomContext = {
  status: ConnStatus
  snapshot: RoomSnapshot | null
  error: string | null
  clearError(): void
  createRoom(name: string, configOverrides?: ConfigOverrides): Promise<string>
  joinRoom(code: string, name: string): Promise<string>
  // Reattaches to a seat stored for `code`. Returns false if there is none.
  resume(code: string): boolean
  send(msg: ClientMsg): void
  imageUrl(card: { imageUrl: string }): string
  // Latest server card library listing, after a listLibrary request.
  library: LibraryCard[] | null
  // Names written by the latest saveCards request; null until one completes.
  savedNames: string[] | null
}

const Ctx = createContext<RoomContext | null>(null)

export function serverUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL
  if (configured) return configured.replace(/\/$/, "")
  const port = process.env.NEXT_PUBLIC_SERVER_PORT ?? "8787"
  return `${window.location.protocol}//${window.location.hostname}:${port}`
}

function wsUrl(): string {
  const url = new URL(serverUrl())
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`
  return url.toString()
}

const seatKey = (code: string) => `cards:seat:${code}`

export function loadSeat(code: string): Seat | null {
  try {
    const raw = localStorage.getItem(seatKey(code))
    return raw ? (JSON.parse(raw) as Seat) : null
  } catch {
    return null
  }
}

function saveSeat(code: string, seat: Seat) {
  localStorage.setItem(seatKey(code), JSON.stringify(seat))
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4)
}

type Pending = { resolve(code: string): void; reject(err: Error): void }

export function RoomProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>("idle")
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryCard[] | null>(null)
  const [savedNames, setSavedNames] = useState<string[] | null>(null)

  const ws = useRef<WebSocket | null>(null)
  const outbox = useRef<ClientMsg[]>([])
  const pendingJoin = useRef<Pending | null>(null)
  // The room this tab is seated in; used to resume after a dropped socket.
  const current = useRef<string | null>(null)
  const retry = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (ws.current && ws.current.readyState <= WebSocket.OPEN) return
    setStatus("connecting")
    const sock = new WebSocket(wsUrl())
    ws.current = sock

    sock.onopen = () => {
      retry.current = 0
      setStatus("open")
      const code = current.current
      const seat = code ? loadSeat(code) : null
      if (code && seat) sock.send(JSON.stringify({ type: "resume", code, token: seat.token } satisfies ClientMsg))
      for (const msg of outbox.current.splice(0)) sock.send(JSON.stringify(msg))
    }

    sock.onmessage = (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg
      } catch {
        return
      }
      if (msg.type === "joined") {
        saveSeat(msg.code, { token: msg.token, playerId: msg.playerId })
        current.current = msg.code
        pendingJoin.current?.resolve(msg.code)
        pendingJoin.current = null
      } else if (msg.type === "state") {
        current.current = msg.snapshot.code
        setSnapshot(msg.snapshot)
      } else if (msg.type === "library") {
        setLibrary(msg.cards)
      } else if (msg.type === "cardsSaved") {
        setSavedNames(msg.names)
      } else if (msg.type === "error") {
        setError(msg.message)
        pendingJoin.current?.reject(new Error(msg.message))
        pendingJoin.current = null
      }
    }

    sock.onclose = () => {
      if (ws.current !== sock) return
      ws.current = null
      setStatus("closed")
      pendingJoin.current?.reject(new Error("Lost connection to the game server"))
      pendingJoin.current = null
      // Only keep reconnecting while seated somewhere.
      if (!current.current) return
      const delay = Math.min(10_000, 500 * 2 ** retry.current++)
      retryTimer.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
      const sock = ws.current
      ws.current = null
      sock?.close()
    },
    [],
  )

  const send = useCallback(
    (msg: ClientMsg) => {
      const sock = ws.current
      if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg))
      else {
        outbox.current.push(msg)
        connect()
      }
    },
    [connect],
  )

  // The server binds one seat per connection, so changing rooms means a new
  // socket. The old one is detached first so its close doesn't reconnect.
  const dropSocket = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const sock = ws.current
    ws.current = null
    current.current = null
    outbox.current = []
    sock?.close()
    setSnapshot(null)
    setLibrary(null)
    setSavedNames(null)
  }, [])

  const awaitJoin = useCallback(
    (msg: ClientMsg) =>
      new Promise<string>((resolve, reject) => {
        pendingJoin.current?.reject(new Error("Superseded"))
        if (current.current) dropSocket()
        pendingJoin.current = { resolve, reject }
        setError(null)
        send(msg)
      }),
    [send, dropSocket],
  )

  const createRoom = useCallback(
    (name: string, configOverrides?: ConfigOverrides) => awaitJoin({ type: "createRoom", name, configOverrides }),
    [awaitJoin],
  )
  const joinRoom = useCallback((code: string, name: string) => awaitJoin({ type: "joinRoom", code, name }), [awaitJoin])

  const resume = useCallback(
    (code: string) => {
      const seat = loadSeat(code)
      if (!seat) return false
      if (current.current === code && ws.current) return true
      if (current.current) dropSocket()
      current.current = code
      setError(null)
      const sock = ws.current
      if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "resume", code, token: seat.token } satisfies ClientMsg))
      else connect()
      return true
    },
    [connect, dropSocket],
  )

  const imageUrl = useCallback((card: { imageUrl: string }) => new URL(card.imageUrl, serverUrl()).toString(), [])
  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<RoomContext>(
    () => ({ status, snapshot, error, clearError, createRoom, joinRoom, resume, send, imageUrl, library, savedNames }),
    [status, snapshot, error, clearError, createRoom, joinRoom, resume, send, imageUrl, library, savedNames],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRoom(): RoomContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useRoom must be used inside <RoomProvider>")
  return ctx
}
