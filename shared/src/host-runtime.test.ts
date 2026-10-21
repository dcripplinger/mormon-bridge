import { describe, expect, it } from 'vitest'
import { HostRuntime } from './host-runtime'
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

async function joinThree(password = 'secret') {
  const host = await HostRuntime.create('ABCD12', password)
  const { sink, inbox } = collectSink()
  host.setSink(sink)

  for (const [sid, name] of [
    ['s0', 'Ada'],
    ['s1', 'Bob'],
    ['s2', 'Cara'],
  ] as const) {
    host.onConnect({ sessionId: sid })
    await host.onMessage(sid, {
      type: 'join',
      password,
      displayName: name,
      avatarId: `av-${name}`,
    })
  }

  return { host, inbox }
}

describe('HostRuntime', () => {
  it('rejects wrong password', async () => {
    const host = await HostRuntime.create('ROOM01', 'right')
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 'x' })
    await host.onMessage('x', {
      type: 'join',
      password: 'wrong',
      displayName: 'X',
      avatarId: 'a',
    })
    expect(inbox.get('x')?.some((m) => m.type === 'error')).toBe(true)
  })

  it('starts a game when host starts and everyone is ready', async () => {
    const { host, inbox } = await joinThree()
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
    const { host, inbox } = await joinThree()
    const joined = (inbox.get('s1') ?? []).find((m) => m.type === 'joined')
    if (!joined || joined.type !== 'joined') throw new Error('no join')
    host.onDisconnect('s1')
    inbox.set('s1b', [])
    host.onConnect({ sessionId: 's1b' })
    await host.onMessage('s1b', {
      type: 'join',
      password: 'secret',
      displayName: 'Bob',
      avatarId: 'av-Bob',
      reconnectToken: joined.reconnectToken,
    })
    const rejoin = (inbox.get('s1b') ?? []).find((m) => m.type === 'joined')
    expect(rejoin && rejoin.type === 'joined' && rejoin.seatIndex).toBe(1)
  })

  it('ranks buys by client-reported elapsedMs', async () => {
    const { host, inbox } = await joinThree()
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
    const host = await HostRuntime.create('RATE01', 'p', () => 1000)
    const { sink, inbox } = collectSink()
    host.setSink(sink)
    host.onConnect({ sessionId: 'n' })
    const join: ClientMessage = {
      type: 'join',
      password: 'p',
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
})
