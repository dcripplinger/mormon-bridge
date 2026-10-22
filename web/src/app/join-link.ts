import { Capacitor } from '@capacitor/core'
import { normalizeRoomCode } from '@mormon-bridge/shared'

/** Fallback origin until a production web client is deployed. */
export const DEFAULT_WEB_ORIGIN = 'http://localhost:5173'

/** Custom scheme registered in the native app (see Android strings.xml / iOS URL types). */
export const APP_JOIN_SCHEME = 'mormonbridge'

/** Build the http(s) join link used for web and share text. */
export function buildWebJoinUrl(roomCode: string): string {
  const code = normalizeRoomCode(roomCode)
  const origin = webJoinOrigin()
  const url = new URL(origin)
  url.searchParams.set('join', code)
  return url.toString()
}

/** Build the custom-scheme link that opens the native app when installed. */
export function buildAppJoinUrl(roomCode: string): string {
  const code = normalizeRoomCode(roomCode)
  return `${APP_JOIN_SCHEME}://join/${code}`
}

/**
 * URL to put in the system share sheet.
 * Native: custom scheme so the OS can open this app.
 * Web: localhost (or current origin) join link.
 */
export function buildShareJoinUrl(roomCode: string): string {
  return Capacitor.isNativePlatform()
    ? buildAppJoinUrl(roomCode)
    : buildWebJoinUrl(roomCode)
}

/** Extract a room code from a join URL (web query, path, or app scheme). */
export function parseJoinCodeFromUrl(href: string): string | null {
  try {
    const url = new URL(href)

    const fromQuery = url.searchParams.get('join')
    if (fromQuery) {
      const code = normalizeRoomCode(fromQuery)
      return code.length >= 4 ? code : null
    }

    // mormonbridge://join/ABCD12 → host "join", pathname "/ABCD12"
    if (
      url.protocol === `${APP_JOIN_SCHEME}:`
      || url.protocol === 'com.mormonbridge.app:'
    ) {
      if (url.hostname.toLowerCase() === 'join') {
        const code = normalizeRoomCode(url.pathname.replace(/^\//, ''))
        return code.length >= 4 ? code : null
      }
      const fromPath = url.pathname.match(/\/join\/([A-Za-z0-9]+)/i)
      if (fromPath) {
        const code = normalizeRoomCode(fromPath[1])
        return code.length >= 4 ? code : null
      }
    }

    const pathMatch = url.pathname.match(/\/join\/([A-Za-z0-9]+)/i)
    if (pathMatch) {
      const code = normalizeRoomCode(pathMatch[1])
      return code.length >= 4 ? code : null
    }
  } catch {
    return null
  }
  return null
}

/** Read join code from the current page URL and strip it from the address bar. */
export function consumeJoinCodeFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const code = parseJoinCodeFromUrl(window.location.href)
  if (!code) return null
  const url = new URL(window.location.href)
  if (url.searchParams.has('join')) {
    url.searchParams.delete('join')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next)
  }
  return code
}

function webJoinOrigin(): string {
  if (typeof location !== 'undefined' && isHttpOrigin(location.origin)) {
    return location.origin
  }
  const fromEnv = import.meta.env.VITE_WEB_ORIGIN
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.replace(/\/$/, '')
  }
  return DEFAULT_WEB_ORIGIN
}

function isHttpOrigin(origin: string): boolean {
  return origin.startsWith('http://') || origin.startsWith('https://')
}
