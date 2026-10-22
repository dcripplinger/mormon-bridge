import { generateRoomCode, normalizeRoomCode } from '@mormon-bridge/shared'
import { RoomDurableObject, type Env } from './room-do'

export { RoomDurableObject }

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function withCors(request: Request, env: Env, res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    headers.set(k, v)
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** Stable DO id from room code. */
function roomStub(env: Env, roomCode: string): DurableObjectStub {
  const id = env.ROOMS.idFromName(normalizeRoomCode(roomCode))
  return env.ROOMS.get(id)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    const url = new URL(request.url)

    if (
      request.method === 'GET'
      && (url.pathname === '/health' || url.pathname === '/api/health')
    ) {
      return withCors(request, env, Response.json({ ok: true }))
    }

    // Create a new private room (code is the only secret; not listed publicly).
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      let body: { tableSize?: number }
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const tableSize = typeof body.tableSize === 'number' ? body.tableSize : undefined

      // Retry a few times on the unlikely code collision with an existing DO that already has state.
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = generateRoomCode()
        const stub = roomStub(env, roomCode)
        const res = await stub.fetch(new Request('https://room/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode, tableSize }),
        }))
        if (res.status === 409) continue
        return withCors(request, env, res)
      }
      return withCors(
        request,
        env,
        Response.json({ error: 'Could not allocate room code' }, { status: 503 }),
      )
    }

    // WebSocket: /api/rooms/:code/ws
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/)
    if (wsMatch) {
      const roomCode = normalizeRoomCode(decodeURIComponent(wsMatch[1]))
      const stub = roomStub(env, roomCode)
      return stub.fetch(new Request('https://room/ws', request))
    }

    return withCors(request, env, new Response('Not found', { status: 404 }))
  },
} satisfies ExportedHandler<Env>
