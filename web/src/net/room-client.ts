import type { ClientMessage, ServerMessage } from '@mormon-bridge/shared'

export type RoomClientStatus = 'connecting' | 'open' | 'closed' | 'error'

export interface RoomClientHandlers {
  onMessage: (msg: ServerMessage) => void
  onStatus?: (status: RoomClientStatus) => void
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
    this.close()
    this.setStatus('connecting')
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.onopen = () => this.setStatus('open')
    ws.onclose = () => {
      this.ws = null
      this.setStatus('closed')
    }
    ws.onerror = () => this.setStatus('error')
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

  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('closed')
  }

  private setStatus(status: RoomClientStatus): void {
    this.handlers.onStatus?.(status)
  }
}

/** HTTP create room → { roomCode }. Server assigns a unique short code. */
export async function createRoom(
  apiBase: string,
  tableSize?: number,
): Promise<{ roomCode: string }> {
  const base = apiBase.replace(/\/$/, '')
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableSize }),
  })
  const body = await res.json() as { roomCode?: string; error?: string }
  if (!res.ok || !body.roomCode) {
    throw new Error(body.error ?? 'Could not create room')
  }
  return { roomCode: body.roomCode }
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
