import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_ROOM_MS, HostRuntime } from './host-runtime'
import type { ClientMessage, ServerMessage } from './protocol'

function collectSink() {
  const inbox = new Map<string, ServerMessage[]>()
  const sink = {
    send(sessionId: string, msg: ServerMessage) {
      const list = inbox.get(sessionId) ?? []
      list.push(msg)
      inbox.set(sessionId, list)
    },
  }
  return { sink, inbox }
}

function joinThree() {
  const host = HostRuntime.create('ABCD12')
  const { sink, inbox } = collectSink()
  host.setSink(sink)

  for (const [sid, name] of [
    ['s0', 'Ada'],
    ['s1', 'Bob'],
    ['s2', 'Cara'],
  ] as const) {
    host.onConnect({ sessionId: sid })
    void host.onMessage(sid, {
      type: 'join',
      displayName: name,
      avatarId: `av-${name}`,
    })
  }

  return { host, inbox }
}

describe('HostRuntime', () => {
  it('rejects a duplicate display name', async () => {
    const host = HostRuntime.create('NAME01')
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    host.onConnect({ sessionId: 's1' })
    await host.onMessage('s1', {
      type: 'join',
      displayName: 'ada',
      avatarId: 'h02',
    })
    expect(
      inbox.get('s1')?.some(
        (m) => m.type === 'error' && m.message.includes('already taken'),
      ),
    ).toBe(true)
    expect(host.roomPublicState().seats.filter((s) => !s.isOpen)).toHaveLength(1)
  })

  it('rejects join when the room is closed', async () => {
    let now = 0
    const host = HostRuntime.create('ROOM01', () => now, 3)
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    now = DEFAULT_MAX_ROOM_MS
    expect(host.onAlarm()).toBeNull()
    host.onConnect({ sessionId: 'x' })
    await host.onMessage('x', {
      type: 'join',
      displayName: 'X',
      avatarId: 'a',
    })
    expect(inbox.get('x')?.some((m) => m.type === 'error' && m.message === 'Room is closed')).toBe(
      true,
    )
  })

  it('starts a game when host starts and everyone is ready', async () => {
    const { host, inbox } = joinThree()
    for (const sid of ['s0', 's1', 's2']) {
      await host.onMessage(sid, { type: 'setReady', ready: true })
    }
    await host.onMessage('s0', { type: 'startGame' })
    const views = (inbox.get('s1') ?? []).filter((m) => m.type === 'clientView')
    expect(views.length).toBeGreaterThan(0)
    const last = views[views.length - 1]
    if (last.type !== 'clientView') throw new Error('expected view')
    expect(last.view.hand).toHaveLength(11)
    expect(last.view.seatIndex).toBe(1)
    expect(host.roomPublicState().phase).toBe('playing')
  })

  it('rebinding with reconnect token restores the seat', async () => {
    const { host, inbox } = joinThree()
    const joined = (inbox.get('s1') ?? []).find((m) => m.type === 'joined')
    if (!joined || joined.type !== 'joined') throw new Error('no join')
    host.onDisconnect('s1')
    inbox.set('s1b', [])
    host.onConnect({ sessionId: 's1b' })
    await host.onMessage('s1b', {
      type: 'join',
      displayName: 'Bob',
      avatarId: 'av-Bob',
      reconnectToken: joined.reconnectToken,
    })
    const rejoin = (inbox.get('s1b') ?? []).find((m) => m.type === 'joined')
    expect(rejoin && rejoin.type === 'joined' && rejoin.seatIndex).toBe(1)
  })

  it('ranks buys by client-reported elapsedMs', async () => {
    const { host, inbox } = joinThree()
    for (const sid of ['s0', 's1', 's2']) {
      await host.onMessage(sid, { type: 'setReady', ready: true })
    }
    await host.onMessage('s0', { type: 'startGame' })

    // Ready up round-prep then reveal
    for (const sid of ['s0', 's1', 's2']) {
      await host.onMessage(sid, { type: 'setReady', ready: true })
    }

    const viewBefore = (inbox.get('s0') ?? []).filter((m) => m.type === 'clientView').at(-1)
    if (!viewBefore || viewBefore.type !== 'clientView') throw new Error('no view')
    expect(viewBefore.view.phase).toBe('buy-window')

    // Seat 1 is slow, seat 2 is fast — seat 2 should win when s0 draws
    await host.onMessage('s1', { type: 'declareBuy', elapsedMs: 2000 })
    await host.onMessage('s2', { type: 'declareBuy', elapsedMs: 100 })
    await host.onMessage('s0', { type: 'drawDeck' })

    const after = (inbox.get('s2') ?? []).filter((m) => m.type === 'clientView').at(-1)
    if (!after || after.type !== 'clientView') throw new Error('no view')
    expect(after.view.hand.length).toBe(13)
    expect(after.view.buyCallerSeats).toEqual([])
  })

  it('rate-limits noisy clients', async () => {
    const host = HostRuntime.create('RATE01', () => 1000)
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 'n' })
    const join: ClientMessage = {
      type: 'join',
      displayName: 'N',
      avatarId: 'a',
    }
    for (let i = 0; i < 20; i++) {
      await host.onMessage('n', join)
    }
    expect(inbox.get('n')?.some((m) => m.type === 'error' && m.message === 'Too many messages')).toBe(
      true,
    )
  })

  it('exposes fixed open seats for the host table size', async () => {
    const host = HostRuntime.create('SIZE01', undefined, 4)
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    const room = host.roomPublicState()
    expect(room.tableSize).toBe(4)
    expect(room.seats).toHaveLength(4)
    expect(room.seats.filter((s) => s.isOpen)).toHaveLength(3)
    expect(room.seats[0]).toMatchObject({ displayName: 'Ada', isOpen: false, isAI: false })
    expect(inbox.get('s0')?.some((m) => m.type === 'joined')).toBe(true)
  })

  it('fills open seats with bots on start and drives AI on alarm', async () => {
    const host = HostRuntime.create('BOTS01', undefined, 3)
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    await host.onMessage('s0', { type: 'setReady', ready: true })
    await host.onMessage('s0', { type: 'startGame' })

    const room = host.roomPublicState()
    expect(room.phase).toBe('playing')
    expect(room.seats.filter((s) => s.isAI)).toHaveLength(2)
    expect(room.seats.every((s) => !s.isOpen)).toBe(true)

    // Round-prep: human readies; host AI readies bots and reveals.
    await host.onMessage('s0', { type: 'setReady', ready: true })
    for (let i = 0; i < 8; i++) {
      host.onAlarm()
      const view = (inbox.get('s0') ?? []).filter((m) => m.type === 'clientView').at(-1)
      if (view && view.type === 'clientView' && view.view.phase === 'buy-window') break
    }
    const view = (inbox.get('s0') ?? []).filter((m) => m.type === 'clientView').at(-1)
    if (!view || view.type !== 'clientView') throw new Error('no view')
    expect(view.view.phase).toBe('buy-window')
    expect(view.view.players.filter((p) => p.isAI)).toHaveLength(2)
  })

  it('preserves session ids across snapshot restore for hibernation', async () => {
    const host = HostRuntime.create('HIBER1')
    const { sink } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    const snap = host.serialize()
    expect(snap.seats[0].sessionId).toBe('s0')

    const restored = HostRuntime.fromSnapshot(snap)
    restored.setSink(sink)
    expect(restored.roomPublicState().seats[0].connected).toBe(true)

    restored.retainOnlySessions(new Set(['s0']))
    await restored.onMessage('s0', { type: 'setReady', ready: true })
    expect(restored.roomPublicState().seats[0].ready).toBe(true)

    restored.retainOnlySessions(new Set())
    expect(restored.roomPublicState().seats[0].connected).toBe(false)
  })

  it('host can toggle a specific seat between open and bot', async () => {
    const host = HostRuntime.create('BOTCHK', undefined, 3)
    const { sink } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    await host.onMessage('s0', { type: 'addBot', seatIndex: 2 })
    let seats = host.roomPublicState().seats
    expect(seats[1].isOpen).toBe(true)
    expect(seats[2].isAI).toBe(true)

    await host.onMessage('s0', { type: 'removeBot', seatIndex: 2 })
    seats = host.roomPublicState().seats
    expect(seats[2].isOpen).toBe(true)
    expect(seats[2].isAI).toBe(false)
  })

  it('lets a joining human replace a lobby bot', async () => {
    const host = HostRuntime.create('REPL01', undefined, 3)
    const { sink } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    await host.onMessage('s0', { type: 'addBot', seatIndex: 1 })
    await host.onMessage('s0', { type: 'addBot', seatIndex: 2 })
    expect(host.roomPublicState().seats.filter((s) => s.isAI)).toHaveLength(2)

    host.onConnect({ sessionId: 's1' })
    await host.onMessage('s1', {
      type: 'join',
      displayName: 'Bob',
      avatarId: 'h02',
    })
    const seats = host.roomPublicState().seats
    expect(seats.filter((s) => s.isAI)).toHaveLength(1)
    expect(seats.some((s) => s.displayName === 'Bob' && !s.isAI)).toBe(true)
  })

  it('host can resize the table when trailing seats are open or bots', async () => {
    const host = HostRuntime.create('RESIZE', undefined, 3)
    const { sink } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 's0' })
    await host.onMessage('s0', {
      type: 'join',
      displayName: 'Ada',
      avatarId: 'h01',
    })
    await host.onMessage('s0', { type: 'setTableSize', tableSize: 5 })
    expect(host.roomPublicState().tableSize).toBe(5)
    expect(host.roomPublicState().seats).toHaveLength(5)

    await host.onMessage('s0', { type: 'addBot', seatIndex: 1 })
    await host.onMessage('s0', { type: 'setTableSize', tableSize: 3 })
    expect(host.roomPublicState().tableSize).toBe(3)
    expect(host.roomPublicState().seats).toHaveLength(3)
  })
})
