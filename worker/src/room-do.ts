import {
  HostRuntime,
  generateRoomCode,
  normalizeRoomCode,
  type ClientMessage,
  type HostRuntimeSnapshot,
  type ServerMessage,
} from '@mormon-bridge/shared'

const STORAGE_KEY = 'runtime'

export interface Env {
  ROOMS: DurableObjectNamespace
  ALLOWED_ORIGINS: string
}

/**
 * One Durable Object per private room. Wraps HostRuntime and hibernatable WebSockets.
 */
export class RoomDurableObject implements DurableObject {
  private runtime: HostRuntime | null = null
  private sessions = new Map<string, WebSocket>()

  constructor(private readonly state: DurableObjectState, _env: Env) {
    this.state.blockConcurrencyWhile(async () => {
      const snap = await this.state.storage.get<HostRuntimeSnapshot>(STORAGE_KEY)
      if (snap) {
        this.runtime = HostRuntime.fromSnapshot(snap)
        this.attachSink()
        this.syncLiveSessions()
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/create') {
      return this.handleCreate(request)
    }

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request)
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        ok: true,
        phase: this.runtime?.roomPublicState().phase ?? 'empty',
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async alarm(): Promise<void> {
    if (!this.runtime) return
    this.attachSink()
    const next = this.runtime.onAlarm()
    await this.persist()
    if (next === null) {
      // Room empty too long — drop storage; sockets already idle
      await this.state.storage.deleteAll()
      this.runtime = null
      for (const ws of this.sessions.values()) {
        try {
          ws.close(1000, 'Room closed')
        } catch {
          /* ignore */
        }
      }
      this.sessions.clear()
      return
    }
    await this.state.storage.setAlarm(Date.now() + next)
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (this.runtime) {
      return Response.json({ error: 'Room already exists' }, { status: 409 })
    }
    let body: { roomCode?: string; tableSize?: number }
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const code = normalizeRoomCode(body.roomCode ?? generateRoomCode())
    if (code.length < 4) {
      return Response.json({ error: 'Invalid room code' }, { status: 400 })
    }
    const tableSize = typeof body.tableSize === 'number' ? body.tableSize : undefined

    this.runtime = HostRuntime.create(code, undefined, tableSize)
    this.attachSink()
    await this.persist()
    await this.scheduleWake()

    return Response.json({ roomCode: code })
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    if (!this.runtime) {
      return Response.json({ error: 'Room not found' }, { status: 404 })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const sessionId = crypto.randomUUID()

    this.state.acceptWebSocket(server)
    this.sessions.set(sessionId, server)
    // Tag the socket so hibernation wake can recover the session id
    server.serializeAttachment({ sessionId })

    this.attachSink()
    this.runtime.onConnect({ sessionId })

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const sessionId = this.sessionIdOf(ws)
    if (!sessionId || !this.runtime) return
    this.sessions.set(sessionId, ws)
    this.attachSink()
    this.syncLiveSessions()

    let msg: ClientMessage
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    } catch {
      this.sendRaw(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    await this.runtime.onMessage(sessionId, msg)
    await this.persist()
    await this.scheduleWake()
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const sessionId = this.sessionIdOf(ws)
    if (!sessionId || !this.runtime) return
    this.sessions.delete(sessionId)
    this.attachSink()
    this.runtime.onDisconnect(sessionId)
    await this.persist()
    await this.scheduleWake()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  private sessionIdOf(ws: WebSocket): string | null {
    const att = ws.deserializeAttachment() as { sessionId?: string } | null
    return att?.sessionId ?? null
  }

  /** Rebuild the socket map from hibernated sockets and prune dead seat bindings. */
  private syncLiveSessions(): void {
    if (!this.runtime) return
    const live = new Set<string>()
    for (const socket of this.state.getWebSockets()) {
      const id = this.sessionIdOf(socket)
      if (!id) continue
      live.add(id)
      this.sessions.set(id, socket)
    }
    for (const id of [...this.sessions.keys()]) {
      if (!live.has(id)) this.sessions.delete(id)
    }
    this.runtime.retainOnlySessions(live)
  }

  private attachSink(): void {
    if (!this.runtime) return
    this.runtime.setSink({
      send: (sessionId, msg) => {
        const ws = this.sessions.get(sessionId)
        if (!ws) {
          // After hibernation, recover from getWebSockets
          for (const socket of this.state.getWebSockets()) {
            if (this.sessionIdOf(socket) === sessionId) {
              this.sessions.set(sessionId, socket)
              this.sendRaw(socket, msg)
              return
            }
          }
          return
        }
        this.sendRaw(ws, msg)
      },
    })
  }

  private sendRaw(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* socket may already be closing */
    }
  }

  private async persist(): Promise<void> {
    if (!this.runtime) return
    await this.state.storage.put(STORAGE_KEY, this.runtime.serialize())
  }

  private async scheduleWake(): Promise<void> {
    if (!this.runtime) return
    await this.state.storage.setAlarm(Date.now() + this.runtime.wakeDelayMs())
  }
}
