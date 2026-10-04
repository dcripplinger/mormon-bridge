import { useEffect, useMemo, useState } from 'react'
import type { AvatarKind } from '../avatars/catalog'
import { avatarsForKind, pickFreeAvatar } from '../avatars/catalog'
import type { PlayerSetup } from '../game/state'
import AvatarView from '../ui/AvatarView'

interface Props {
  onStart: (players: PlayerSetup[]) => void
}

interface SeatDraft {
  kind: AvatarKind
  avatarId: string
}

const MIN_PLAYERS = 3
const MAX_PLAYERS = 5

function defaultSeats(): SeatDraft[] {
  const seats: SeatDraft[] = []
  for (let i = 0; i < MIN_PLAYERS; i++) {
    const kind: AvatarKind = i === 0 ? 'human' : 'bot'
    seats.push({
      kind,
      avatarId: pickFreeAvatar(
        kind,
        seats.map((s) => s.avatarId),
      ),
    })
  }
  return seats
}

function displayNameFor(seats: SeatDraft[], index: number): string {
  if (index === 0) return 'You'
  const seat = seats[index]
  if (seat.kind === 'human') {
    const humanOrdinal = seats
      .slice(0, index + 1)
      .filter((s) => s.kind === 'human').length
    return `Player ${humanOrdinal}`
  }
  const botOrdinal = seats.slice(0, index + 1).filter((s) => s.kind === 'bot').length
  return `Bot ${botOrdinal}`
}

export default function MenuScreen({ onStart }: Props) {
  const [seats, setSeats] = useState<SeatDraft[]>(defaultSeats)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const editingSeat = editingIndex === null ? null : seats[editingIndex]
  const takenByOthers = useMemo(() => {
    if (editingIndex === null) return new Set<string>()
    const taken = new Set<string>()
    seats.forEach((s, j) => {
      if (j !== editingIndex) taken.add(s.avatarId)
    })
    return taken
  }, [seats, editingIndex])

  useEffect(() => {
    if (editingIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingIndex])

  const addPlayer = () => {
    if (seats.length >= MAX_PLAYERS) return
    setSeats((prev) => [
      ...prev,
      {
        kind: 'bot',
        avatarId: pickFreeAvatar(
          'bot',
          prev.map((s) => s.avatarId),
        ),
      },
    ])
  }

  const removePlayer = (index: number) => {
    if (index === 0 || seats.length <= MIN_PLAYERS) return
    setSeats((prev) => prev.filter((_, i) => i !== index))
    setEditingIndex((curr) => {
      if (curr === null) return null
      if (curr === index) return null
      if (curr > index) return curr - 1
      return curr
    })
  }

  const setKind = (index: number, kind: AvatarKind) => {
    if (index === 0 && kind !== 'human') return
    setSeats((prev) =>
      prev.map((seat, i) => {
        if (i !== index) return seat
        if (seat.kind === kind) return seat
        const taken = prev.filter((_, j) => j !== index).map((s) => s.avatarId)
        return { kind, avatarId: pickFreeAvatar(kind, taken) }
      }),
    )
  }

  const setAvatar = (index: number, avatarId: string) => {
    setSeats((prev) =>
      prev.map((seat, i) => (i === index ? { ...seat, avatarId } : seat)),
    )
  }

  const handleStart = () => {
    if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return
    onStart(
      seats.map((seat, i) => ({
        displayName: displayNameFor(seats, i),
        isAI: seat.kind === 'bot',
        avatarId: seat.avatarId,
      })),
    )
  }

  const canRemove = seats.length > MIN_PLAYERS

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '20px',
        background: 'var(--bg)',
        padding: '20px 16px',
        overflowY: 'auto',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 'clamp(1.8rem, 6vw, 3rem)',
            color: 'var(--text)',
            letterSpacing: '0.04em',
          }}
        >
          Mormon Bridge
        </h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '6px', fontSize: '0.9rem' }}>
          A rummy card game for 3–5 players
        </p>
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          width: 'min(420px, 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            justifyContent: 'center',
          }}
        >
          {seats.map((seat, index) => {
            const name = displayNameFor(seats, index)
            const showTrash = index > 0 && canRemove
            return (
              <div
                key={index}
                style={{
                  position: 'relative',
                  width: '88px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '10px 8px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {showTrash && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => removePlayer(index)}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      width: '22px',
                      height: '22px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      lineHeight: 0,
                    }}
                  >
                    <TrashIcon />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setEditingIndex(index)}
                  aria-label={`Change avatar for ${name}`}
                  style={{
                    background: 'transparent',
                    border: '2px solid transparent',
                    borderRadius: '50%',
                    padding: '2px',
                    lineHeight: 0,
                  }}
                >
                  <AvatarView avatarId={seat.avatarId} size={52} alt="" />
                </button>

                <div
                  style={{
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    textAlign: 'center',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </div>
              </div>
            )
          })}

          {seats.length < MAX_PLAYERS && (
            <button
              type="button"
              onClick={addPlayer}
              aria-label="Add player"
              style={{
                width: '88px',
                minHeight: '96px',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderRadius: '12px',
                color: 'var(--text-dim)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>+</span>
              Add
            </button>
          )}
        </div>

        <button
          onClick={handleStart}
          style={{
            background: 'var(--accent)',
            color: '#1a1a1a',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '1.05rem',
            fontWeight: 'bold',
          }}
        >
          Start Game
        </button>
      </div>

      <p
        style={{
          color: 'var(--text-dim)',
          fontSize: '0.72rem',
          maxWidth: '320px',
          textAlign: 'center',
        }}
      >
        Round 1: 2 groups · Round 2: 1 group + 1 run · ... · Round 7: 3 runs
      </p>

      {editingSeat && editingIndex !== null && (
        <AvatarPickerModal
          name={displayNameFor(seats, editingIndex)}
          seat={editingSeat}
          canChangeKind={editingIndex !== 0}
          takenIds={takenByOthers}
          onKindChange={(kind) => setKind(editingIndex, kind)}
          onAvatarChange={(id) => setAvatar(editingIndex, id)}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </div>
  )
}

function AvatarPickerModal({
  name,
  seat,
  canChangeKind,
  takenIds,
  onKindChange,
  onAvatarChange,
  onClose,
}: {
  name: string
  seat: SeatDraft
  canChangeKind: boolean
  takenIds: Set<string>
  onKindChange: (kind: AvatarKind) => void
  onAvatarChange: (avatarId: string) => void
  onClose: () => void
}) {
  const options = avatarsForKind(seat.kind)

  return (
    <>
      <button
        type="button"
        aria-label="Close avatar picker"
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
        aria-label={`Choose avatar for ${name}`}
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(340px, calc(100vw - 32px))',
          maxHeight: 'min(480px, calc(100vh - 32px))',
          overflowY: 'auto',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AvatarView avatarId={seat.avatarId} size={44} alt="" />
            <div>
              <div style={{ color: 'var(--text)', fontWeight: 700 }}>{name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                Choose an avatar
              </div>
            </div>
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

        {canChangeKind && (
          <div
            role="group"
            aria-label="Player type"
            style={{ display: 'flex', gap: '6px' }}
          >
            {(['human', 'bot'] as const).map((kind) => {
              const selected = seat.kind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onKindChange(kind)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: selected
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                    background: selected ? 'var(--accent)' : 'var(--surface-2)',
                    color: selected ? '#1a1a1a' : 'var(--text)',
                    fontWeight: selected ? 700 : 500,
                    fontSize: '0.85rem',
                  }}
                >
                  {kind === 'human' ? 'Human' : 'Bot'}
                </button>
              )
            })}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
          }}
        >
          {options.map((avatar) => {
            const selected = seat.avatarId === avatar.id
            const takenElsewhere = takenIds.has(avatar.id)
            return (
              <button
                key={avatar.id}
                type="button"
                disabled={takenElsewhere}
                title={
                  takenElsewhere
                    ? 'Already chosen by another player'
                    : avatar.label
                }
                aria-label={avatar.label}
                aria-pressed={selected}
                onClick={() => onAvatarChange(avatar.id)}
                style={{
                  padding: '4px',
                  borderRadius: '10px',
                  border: selected
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  background: selected ? 'var(--surface-2)' : 'transparent',
                  opacity: takenElsewhere ? 0.35 : 1,
                  lineHeight: 0,
                }}
              >
                <AvatarView avatarId={avatar.id} size={56} alt={avatar.label} />
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'var(--accent)',
            color: '#1a1a1a',
            padding: '10px',
            borderRadius: '8px',
            fontWeight: 700,
          }}
        >
          Done
        </button>
      </div>
    </>
  )
}

function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 1.5h3M2 3h8M9.5 3l-.4 6.2a1 1 0 0 1-1 .8H3.9a1 1 0 0 1-1-.8L2.5 3M5 5v3.5M7 5v3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
