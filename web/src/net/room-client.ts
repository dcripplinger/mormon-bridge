import type { ClientMessage, ServerMessage } from '@mormon-bridge/shared'

export type RoomClientStatus = 'connecting' | 'open' | 'closed' | 'error'

export interface RoomClientHandlers {
  onMessage: (msg: ServerMessage) => void
  onStatus?: (status: RoomClientStatus) => void
}

export interface CloseOptions {
  /** When true, do not emit a status change (intentional disconnect). */
  silent?: boolean
}

/**
 * Thin WebSocket client for a private room. Transport only — no game logic.
 */
export class RoomClient {
  private ws: WebSocket | null = null
  private readonly handlers: RoomClientHandlers

  constructor(handlers: RoomClientHandlers) {
    this.handlers = handlers
  }

  connect(wsUrl: string): void {
    this.close({ silent: true })
    this.setStatus('connecting')
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.onopen = () => this.setStatus('open')
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.setStatus('closed')
    }
    ws.onerror = () => {
      if (this.ws !== ws) return
      this.setStatus('error')
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        this.handlers.onMessage(msg)
      } catch {
        /* ignore malformed */
      }
    }
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  close(opts?: CloseOptions): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    if (!opts?.silent) {
      this.setStatus('closed')
    }
  }

  private setStatus(status: RoomClientStatus): void {
    this.handlers.onStatus?.(status)
  }
}

export class ApiUnreachableError extends Error {
  constructor(message = 'Could not reach the game server') {
    super(message)
    this.name = 'ApiUnreachableError'
  }
}

/** HTTP create room → { roomCode }. Server assigns a unique short code. */
export async function createRoom(
  apiBase: string,
  tableSize?: number,
): Promise<{ roomCode: string }> {
  const base = apiBase.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableSize }),
    })
  } catch {
    throw new ApiUnreachableError()
  }

  let body: { roomCode?: string; error?: string } = {}
  try {
    body = await res.json() as { roomCode?: string; error?: string }
  } catch {
    /* non-JSON (e.g. proxy 502 HTML) */
  }

  if (!res.ok || !body.roomCode) {
    if (res.status >= 500 || res.status === 0) {
      throw new ApiUnreachableError()
    }
    throw new Error(body.error ?? 'Could not create room')
  }
  return { roomCode: body.roomCode }
}

/**
 * Lightweight reachability probe for the multiplayer Worker.
 * Uses `/api/health` so the Vite `/api` proxy covers local wrangler.
 */
export async function checkApiReachable(
  apiBase: string,
  timeoutMs = 4000,
): Promise<boolean> {
  const base = apiBase.replace(/\/$/, '')
  const url = `${base}/api/health`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return false
    const body = await res.json() as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function roomWebSocketUrl(apiBase: string, roomCode: string): string {
  const path = `/api/rooms/${encodeURIComponent(roomCode)}/ws`
  if (!apiBase) {
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = typeof location !== 'undefined' ? location.host : '127.0.0.1:5173'
    return `${proto}//${host}${path}`
  }
  const base = apiBase.replace(/\/$/, '')
  const wsBase = base.replace(/^http/, 'ws')
  return `${wsBase}${path}`
}

/** Empty string = same origin (Vite proxy to wrangler in dev). */
export function defaultApiBase(): string {
  return import.meta.env.VITE_API_BASE ?? ''
}
