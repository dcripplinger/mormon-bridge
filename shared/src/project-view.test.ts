import { describe, expect, it } from 'vitest'
import { createGame, declareBuy, revealOpeningDiscard, setReady } from '../../web/src/game/state'
import { projectView } from './project-view'

function openThreePlayer() {
  let s = createGame([
    { displayName: 'A', isAI: false, avatarId: 'h1' },
    { displayName: 'B', isAI: false, avatarId: 'h2' },
    { displayName: 'C', isAI: false, avatarId: 'h3' },
  ], { roundLeaderIndex: 0 })
  s = setReady(s, 0, true)
  s = setReady(s, 1, true)
  s = setReady(s, 2, true)
  return revealOpeningDiscard(s)
}

describe('projectView', () => {
  it('includes only the viewer hand and never the draw pile', () => {
    const state = openThreePlayer()
    const view = projectView(state, 1)
    expect(view.hand).toHaveLength(11)
    expect(view.hand.map((c) => c.id).sort()).toEqual(
      state.players[1].hand.map((c) => c.id).sort(),
    )
    expect(view.players[0].handCount).toBe(11)
    expect(view.drawCount).toBe(state.drawPile.length)
    expect(view).not.toHaveProperty('drawPile')
    expect(JSON.stringify(view)).not.toContain(state.drawPile[0].id)
  })

  it('exposes buy caller seats without elapsedMs', () => {
    const state = declareBuy(openThreePlayer(), 1, 400)
    const view = projectView(state, 0)
    expect(view.buyCallerSeats).toEqual([1])
    expect(JSON.stringify(view)).not.toContain('elapsedMs')
  })
})
