import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Card } from './card'
import { aiLog, formatHandShort, isAiDebugEnabled } from './ai-log'

function card(id: string, color: Card['color'], number: number): Card {
  return { id, color, number }
}

describe('ai-log', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is disabled when VITE_AI_DEBUG is unset', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_AI_DEBUG', '')
    expect(isAiDebugEnabled()).toBe(false)
  })

  it('is disabled in production even with the flag', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_AI_DEBUG', '1')
    expect(isAiDebugEnabled()).toBe(false)
  })

  it('is enabled only for DEV + VITE_AI_DEBUG=1', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_AI_DEBUG', '1')
    expect(isAiDebugEnabled()).toBe(true)
  })

  it('formats hand shorthand in ascending order', () => {
    const hand = [
      card('a', 'black', 12),
      card('b', 'red', 5),
      card('c', 'wild', 0),
      card('d', 'red', 9),
      card('e', 'yellow', 1),
    ]
    expect(formatHandShort(hand)).toBe('R5 R9 Y1 B12 WILD')
  })

  it('aiLog writes multiline hand and target when enabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const hand = [card('a', 'red', 9), card('b', 'yellow', 5)]
    const target = card('t', 'green', 5)

    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_AI_DEBUG', '')
    aiLog({
      playerLabel: 'Bot#1',
      decision: 'buy',
      reason: 'should not log',
      hand,
      target,
    })
    expect(spy).not.toHaveBeenCalled()

    vi.stubEnv('VITE_AI_DEBUG', '1')
    aiLog({
      playerLabel: 'Bot#1',
      decision: 'buy',
      reason: 'takes the 5s',
      hand,
      target,
      details: { acquireValue: 20 },
    })
    expect(spy).toHaveBeenCalledWith(
      [
        '[AI] Bot#1 → buy',
        '  hand:   R9 Y5',
        '  target: G5',
        '  reason: takes the 5s',
        '  details:',
      ].join('\n'),
      { acquireValue: 20 },
    )
  })
})
