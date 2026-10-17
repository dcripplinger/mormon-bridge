import { useEffect, useState } from 'react'
import { TOTAL_ROUNDS } from '../game/rules'
import type { PlayerState } from '../game/state'
import AvatarView from './AvatarView'

interface RoundRecapProps {
  players: PlayerState[]
  humanIndex: number
  roundIndex: number
  victorIndex: number | null
  onContinue: () => void
}

export default function RoundRecap({
  players,
  humanIndex,
  roundIndex,
  victorIndex,
  onContinue,
}: RoundRecapProps) {
  const human = players[humanIndex]
  const taken = human?.roundScores[roundIndex] ?? 0
  const total = human?.cumulativeScore ?? 0
  const before = total - taken
  const [shown, setShown] = useState(0)
  const finalRound = roundIndex + 1 >= TOTAL_ROUNDS
  const victor = victorIndex != null ? players[victorIndex] : null

  useEffect(() => {
    const start = performance.now()
    const duration = 700
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setShown(Math.round(taken * t))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [taken, roundIndex])

  return (
    <div className="round-recap">
      <div className="round-recap__card" role="dialog" aria-label="Round recap">
        <h2 className="round-recap__title">Round {roundIndex + 1}</h2>
        {victor && <p className="round-recap__victor">{victor.displayName} went out</p>}

        {human && (
          <div className="round-recap__you">
            <AvatarView avatarId={human.avatarId} size={40} alt="" />
            <div>
              <div className="round-recap__name">{human.displayName}</div>
              <div className="round-recap__points">
                +{shown} this round, now {before + shown}
              </div>
            </div>
          </div>
        )}

        <ul className="round-recap__others">
          {players.map((p) => {
            if (p.index === humanIndex) return null
            const roundPoints = p.roundScores[roundIndex] ?? 0
            return (
              <li key={p.index}>
                <AvatarView avatarId={p.avatarId} size={28} alt="" />
                <span>
                  {p.displayName} · {p.hand.length} cards · +{roundPoints} · {p.cumulativeScore} total
                </span>
              </li>
            )
          })}
        </ul>

        <div className="round-recap__table-wrap">
          <table className="round-recap__table">
            <thead>
              <tr>
                <th />
                {Array.from({ length: TOTAL_ROUNDS }, (_, i) => (
                  <th key={i} className={i === roundIndex ? 'is-current' : undefined}>
                    {i + 1}
                  </th>
                ))}
                <th>Tot</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.index} className={p.index === humanIndex ? 'is-you' : undefined}>
                  <th>{p.displayName}</th>
                  {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
                    const value = p.roundScores[i]
                    return (
                      <td key={i} className={i === roundIndex ? 'is-current' : undefined}>
                        {value == null ? '' : value}
                      </td>
                    )
                  })}
                  <td>{p.cumulativeScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="round-recap__next" onClick={onContinue}>
          {finalRound ? 'Final scores' : 'Next round'}
        </button>
      </div>
    </div>
  )
}
