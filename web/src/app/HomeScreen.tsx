import { useEffect, useState } from 'react'
import type { GameState } from '../game/state'
import type { ApiReachability } from '../net/use-api-reachable'

interface Props {
  activeGame: GameState | null
  onSoloSetup: () => void
  onContinue: () => void
  onQuit: () => void
  onCreateOnline: () => void
  onJoinOnline: () => void
  /** Multiplayer API reachability; online buttons stay off until available. */
  onlineStatus: ApiReachability
}

export default function HomeScreen({
  activeGame,
  onSoloSetup,
  onContinue,
  onQuit,
  onCreateOnline,
  onJoinOnline,
  onlineStatus,
}: Props) {
  const [continueOpen, setContinueOpen] = useState(false)

  useEffect(() => {
    if (!continueOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContinueOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [continueOpen])

  const handleSinglePlayer = () => {
    if (activeGame) {
      setContinueOpen(true)
      return
    }
    onSoloSetup()
  }

  const handleStartNew = () => {
    setContinueOpen(false)
    onQuit()
    onSoloSetup()
  }

  const onlineEnabled = onlineStatus === 'available'
  const onlineHint =
    onlineStatus === 'unavailable'
      ? 'Online play unavailable. Check your connection and try again.'
      : onlineStatus === 'checking'
        ? 'Checking online play…'
        : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '28px',
        background: 'var(--bg)',
        padding: '20px 28px',
      }}
    >
      <h1
        style={{
          margin: 0,
          color: 'var(--text)',
          fontSize: '1.85rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          textAlign: 'center',
        }}
      >
        Mormon Bridge
      </h1>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '36px',
          width: 'min(360px, 100%)',
          boxSizing: 'border-box',
        }}
      >
        <button type="button" className="btn btn--primary btn--block" onClick={handleSinglePlayer}>
          Single Player
        </button>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={onCreateOnline}
          disabled={!onlineEnabled}
        >
          Create Online Game
        </button>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={onJoinOnline}
          disabled={!onlineEnabled}
        >
          Join Online Game
        </button>
        {onlineHint && (
          <p
            style={{
              margin: 0,
              color: 'var(--text-dim)',
              fontSize: '0.85rem',
              lineHeight: 1.4,
              textAlign: 'center',
            }}
          >
            {onlineHint}
          </p>
        )}
      </div>

      {continueOpen && (
        <ContinueModal
          onContinue={() => {
            setContinueOpen(false)
            onContinue()
          }}
          onStartNew={handleStartNew}
          onClose={() => setContinueOpen(false)}
        />
      )}
    </div>
  )
}

function ContinueModal({
  onContinue,
  onStartNew,
  onClose,
}: {
  onContinue: () => void
  onStartNew: () => void
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close continue game dialog"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          border: 'none',
          padding: 0,
          zIndex: 40,
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Continue or start a new game"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(360px, calc(100vw - 32px))',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '16px',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1.05rem' }}>
            Game in progress
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-dim)',
              fontSize: '1.1rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.4 }}>
          You have a single player game in progress. Continue where you left off, or start a new one.
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={onContinue}>
          Continue Game
        </button>
        <button type="button" className="btn btn--secondary btn--block" onClick={onStartNew}>
          Start New Game
        </button>
      </div>
    </>
  )
}
