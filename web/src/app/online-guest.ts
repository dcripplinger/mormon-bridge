import { normalizeRoomCode } from '@mormon-bridge/shared'
import type { OnlineReconnect } from './persistence'

/** Legacy / guest sessionStorage key (prod reconnect now lives in Preferences). */
export const SESSION_RECONNECT_KEY = 'mb:online-reconnect'

export const RECONNECTED_ELSEWHERE = 'Reconnected elsewhere'

/** Read `guest` query value; null when the param is absent. */
export function readGuestParam(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(query)
  if (!params.has('guest')) return null
  return params.get('guest') ?? ''
}

/** DEV-only guest tabs: multi-client testing without touching durable identity. */
export function isDevGuestMode(isDev: boolean, search: string): boolean {
  return isDev && readGuestParam(search) !== null
}

/** Prefill name for `?guest=2` → "Guest 2"; `?guest=alice` → "alice". */
export function guestDisplayName(guestValue: string): string {
  const v = guestValue.trim()
  if (!v) return 'Guest'
  if (/^\d+$/.test(v)) return `Guest ${v}`
  return v.slice(0, 24)
}

/** Next guest id for the "Open guest tab" control. */
export function nextGuestId(currentGuest: string | null): string {
  if (currentGuest !== null && /^\d+$/.test(currentGuest.trim())) {
    return String(Number(currentGuest.trim()) + 1)
  }
  return '2'
}

/** Build a same-origin URL with `guest` (and optional `join`) for a new tab. */
export function buildGuestOpenUrl(
  currentHref: string,
  guestId: string,
  roomCode?: string,
): string {
  const url = new URL(currentHref)
  url.searchParams.set('guest', guestId)
  if (roomCode) {
    const code = normalizeRoomCode(roomCode)
    if (code.length >= 4) url.searchParams.set('join', code)
  }
  return url.toString()
}

export function formatKickReason(reason: string): string {
  if (reason === RECONNECTED_ELSEWHERE) return 'Opened in another tab'
  return reason
}

export function parseSessionReconnect(raw: string | null): OnlineReconnect | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OnlineReconnect>
    if (
      typeof parsed.roomCode !== 'string'
      || typeof parsed.reconnectToken !== 'string'
      || typeof parsed.displayName !== 'string'
      || typeof parsed.avatarId !== 'string'
    ) {
      return null
    }
    if (
      !parsed.roomCode
      || !parsed.reconnectToken
      || !parsed.displayName.trim()
      || !parsed.avatarId
    ) {
      return null
    }
    return {
      roomCode: parsed.roomCode,
      reconnectToken: parsed.reconnectToken,
      displayName: parsed.displayName,
      avatarId: parsed.avatarId,
    }
  } catch {
    return null
  }
}

export function loadSessionReconnect(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): OnlineReconnect | null {
  return parseSessionReconnect(storage.getItem(SESSION_RECONNECT_KEY))
}

export function saveSessionReconnect(
  data: OnlineReconnect,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
): void {
  storage.setItem(SESSION_RECONNECT_KEY, JSON.stringify(data))
}

export function clearSessionReconnect(
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  storage.removeItem(SESSION_RECONNECT_KEY)
}
