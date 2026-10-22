import { describe, expect, it } from 'vitest'
import {
  SESSION_RECONNECT_KEY,
  buildGuestOpenUrl,
  clearSessionReconnect,
  formatKickReason,
  guestDisplayName,
  isDevGuestMode,
  loadSessionReconnect,
  nextGuestId,
  parseSessionReconnect,
  readGuestParam,
  saveSessionReconnect,
} from './online-guest'

describe('readGuestParam / isDevGuestMode', () => {
  it('returns null when guest is absent', () => {
    expect(readGuestParam('')).toBeNull()
    expect(readGuestParam('?join=ABCD12')).toBeNull()
    expect(isDevGuestMode(true, '?join=ABCD12')).toBe(false)
  })

  it('reads empty and named guest values', () => {
    expect(readGuestParam('?guest')).toBe('')
    expect(readGuestParam('?guest=2')).toBe('2')
    expect(readGuestParam('guest=alice')).toBe('alice')
  })

  it('is only active in DEV when guest is present', () => {
    expect(isDevGuestMode(true, '?guest=2')).toBe(true)
    expect(isDevGuestMode(false, '?guest=2')).toBe(false)
  })
})

describe('guestDisplayName', () => {
  it('maps numeric ids to Guest N', () => {
    expect(guestDisplayName('2')).toBe('Guest 2')
    expect(guestDisplayName(' 10 ')).toBe('Guest 10')
  })

  it('uses the param as a name otherwise', () => {
    expect(guestDisplayName('')).toBe('Guest')
    expect(guestDisplayName('alice')).toBe('alice')
  })
})

describe('nextGuestId / buildGuestOpenUrl', () => {
  it('increments numeric guests and defaults to 2', () => {
    expect(nextGuestId('2')).toBe('3')
    expect(nextGuestId(null)).toBe('2')
    expect(nextGuestId('alice')).toBe('2')
  })

  it('sets guest and optional join on the URL', () => {
    const url = buildGuestOpenUrl('http://localhost:5173/online', '3', 'ab cd12')
    expect(url).toContain('guest=3')
    expect(url).toContain('join=ABCD12')
  })
})

describe('formatKickReason', () => {
  it('maps reconnect takeover to a clear message', () => {
    expect(formatKickReason('Reconnected elsewhere')).toBe('Opened in another tab')
    expect(formatKickReason('Left the room')).toBe('Left the room')
  })
})

describe('session reconnect helpers', () => {
  it('round-trips via a Storage stand-in', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v)
      },
      removeItem: (k: string) => {
        map.delete(k)
      },
    }
    saveSessionReconnect(
      {
        roomCode: 'ABCD12',
        reconnectToken: 'tok',
        displayName: 'Guest 2',
        avatarId: 'h01',
      },
      storage,
    )
    expect(loadSessionReconnect(storage)).toEqual({
      roomCode: 'ABCD12',
      reconnectToken: 'tok',
      displayName: 'Guest 2',
      avatarId: 'h01',
    })
    expect(map.has(SESSION_RECONNECT_KEY)).toBe(true)
    clearSessionReconnect(storage)
    expect(loadSessionReconnect(storage)).toBeNull()
  })

  it('parseSessionReconnect rejects bad JSON / incomplete objects', () => {
    expect(parseSessionReconnect('not-json')).toBeNull()
    expect(parseSessionReconnect(JSON.stringify({ roomCode: 'A' }))).toBeNull()
  })
})
