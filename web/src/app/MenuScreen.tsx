import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { avatarsForKind, pickFreeAvatar } from '../avatars/catalog'
import type { GameState, PlayerSetup } from '../game/state'
import AvatarView from '../ui/AvatarView'
import { normalizeSeats, savePrefs } from './persistence'
import type { GameSettings, SeatDraft, WildMoveFrom, WildMoveTo } from './types'

export type { GameSettings, SeatDraft, WildMoveFrom, WildMoveTo }

interface Props {
  initialSeats?: SeatDraft[]
  initialSettings?: GameSettings
  /** Non-null when a saved game exists; shows Continue / Quit instead of Start. */
  activeGame: GameState | null
  onStart: (players: PlayerSetup[]) => void
  onContinue: () => void
  onQuit: () => void
}

const DEFAULT_GAME_SETTINGS: GameSettings = {
  wildMoveFrom: 'runs',
  wildMoveTo: 'any-meld',
}

const WILD_MOVE_FROM_OPTIONS: { value: WildMoveFrom; label: string }[] = [
  { value: 'runs', label: 'Runs' },
  { value: 'runs-or-groups', label: 'Runs or groups' },
  { value: 'nowhere', label: 'Nowhere' },
]

const WILD_MOVE_TO_OPTIONS: {
  value: WildMoveTo
  label: string
  /** When set, used instead of label if wilds can only be taken from runs. */
  labelWhenFromRuns?: string
}[] = [
  {
    value: 'any-meld',
    label: 'Any run or group',
  },
  {
    value: 'any-meld-or-hand',
    label: 'Any run or group, or keep in hand',
  },
  {
    value: 'same-meld',
    label: 'Same run or group',
    labelWhenFromRuns: 'Same run',
  },
]

const MIN_PLAYERS = 3
const MAX_PLAYERS = 5

function defaultSeats(): SeatDraft[] {
  const seats: SeatDraft[] = []
  for (let i = 0; i < MIN_PLAYERS; i++) {
    const kind = (i === 0 ? 'human' : 'bot') as SeatDraft['kind']
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

function displayNameFor(index: number): string {
  if (index === 0) return 'You'
  return `Bot ${index}`
}

export default function MenuScreen({
  initialSeats,
  initialSettings,
  activeGame,
  onStart,
  onContinue,
  onQuit,
}: Props) {
  const [seats, setSeats] = useState<SeatDraft[]>(() =>
    normalizeSeats(
      initialSeats && initialSeats.length > 0 ? initialSeats : defaultSeats(),
    ),
  )
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [settings, setSettings] = useState<GameSettings>(
    initialSettings ?? DEFAULT_GAME_SETTINGS,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [howToPlayOpen, setHowToPlayOpen] = useState(false)

  // Persist seats + settings whenever they change so they survive refresh / reopen
  useEffect(() => {
    savePrefs(seats, settings)
  }, [seats, settings])

  const editingSeat = editingIndex === null ? null : seats[editingIndex]
  const takenByOthers = useMemo(() => {
    if (editingIndex === null) return new Set<string>()
    const taken = new Set<string>()
    seats.forEach((s, j) => {
      if (j !== editingIndex) taken.add(s.avatarId)
    })
    return taken
  }, [seats, editingIndex])

  const openAvatarPicker = (index: number) => {
    setSettingsOpen(false)
    setHowToPlayOpen(false)
    setEditingIndex(index)
  }

  const openSettings = () => {
    setEditingIndex(null)
    setHowToPlayOpen(false)
    setSettingsOpen(true)
  }

  const openHowToPlay = () => {
    setEditingIndex(null)
    setSettingsOpen(false)
    setHowToPlayOpen(true)
  }

  useEffect(() => {
    if (editingIndex === null && !settingsOpen && !howToPlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setEditingIndex(null)
      setSettingsOpen(false)
      setHowToPlayOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingIndex, settingsOpen, howToPlayOpen])

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

  const setAvatar = (index: number, avatarId: string) => {
    setSeats((prev) =>
      prev.map((seat, i) => (i === index ? { ...seat, avatarId } : seat)),
    )
  }

  const handleStart = () => {
    if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return
    onStart(
      seats.map((seat, i) => ({
        displayName: displayNameFor(i),
        isAI: i !== 0,
        avatarId: seat.avatarId,
      })),
    )
  }

  const hasActiveGame = activeGame !== null

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
        {!hasActiveGame && <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            justifyContent: 'center',
          }}
        >
          {seats.map((seat, index) => {
            const name = displayNameFor(index)
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
                  onClick={() => openAvatarPicker(index)}
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
        </div>}

        {!hasActiveGame && <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={openSettings}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '10px 8px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            Game Settings
          </button>
          <button
            type="button"
            onClick={openHowToPlay}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '10px 8px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            How to Play
          </button>
        </div>}

        {hasActiveGame ? (
          <>
            <button
              onClick={onContinue}
              style={{
                background: 'var(--accent)',
                color: '#1a1a1a',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '1.05rem',
                fontWeight: 'bold',
              }}
            >
              Continue Game
            </button>
            <button
              type="button"
              onClick={onQuit}
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-dim)',
                border: '1px solid var(--border)',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              Quit &amp; Start New Game
            </button>
          </>
        ) : (
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
        )}
      </div>

      {editingSeat && editingIndex !== null && (
        <AvatarPickerModal
          name={displayNameFor(editingIndex)}
          seat={editingSeat}
          takenIds={takenByOthers}
          onAvatarChange={(id) => setAvatar(editingIndex, id)}
          onClose={() => setEditingIndex(null)}
        />
      )}

      {settingsOpen && (
        <GameSettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {howToPlayOpen && (
        <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />
      )}
    </div>
  )
}

function ModalShell({
  title,
  ariaLabel,
  onClose,
  children,
  width = 'min(360px, calc(100vw - 32px))',
}: {
  title: string
  ariaLabel: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  return (
    <>
      <button
        type="button"
        aria-label={`Close ${ariaLabel}`}
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
        aria-label={ariaLabel}
        className="scroll-hide"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width,
          maxHeight: 'min(520px, calc(100vh - 32px))',
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
            {title}
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
        {children}
      </div>
    </>
  )
}

function SettingSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: 'var(--text)',
        fontSize: '0.85rem',
        fontWeight: 600,
      }}
    >
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface-2)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '10px 12px',
          fontSize: '0.9rem',
          fontFamily: 'inherit',
          fontWeight: 500,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function GameSettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: GameSettings
  onChange: (next: GameSettings) => void
  onClose: () => void
}) {
  const fromRuns = settings.wildMoveFrom === 'runs'
  const showToDropdown = settings.wildMoveFrom !== 'nowhere'

  return (
    <ModalShell title="Game Settings" ariaLabel="Game settings" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <SettingSelect
          id="wild-move-from"
          label="Can move a wild from"
          value={settings.wildMoveFrom}
          options={WILD_MOVE_FROM_OPTIONS}
          onChange={(value) =>
            onChange({ ...settings, wildMoveFrom: value as WildMoveFrom })
          }
        />
        {showToDropdown && (
          <SettingSelect
            id="wild-move-to"
            label="Can move a wild to"
            value={settings.wildMoveTo}
            options={WILD_MOVE_TO_OPTIONS.map((opt) => ({
              value: opt.value,
              label:
                fromRuns && opt.labelWhenFromRuns
                  ? opt.labelWhenFromRuns
                  : opt.label,
            }))}
            onChange={(value) =>
              onChange({ ...settings, wildMoveTo: value as WildMoveTo })
            }
          />
        )}
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
    </ModalShell>
  )
}

function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="How to Play"
      ariaLabel="How to play"
      onClose={onClose}
      width="min(400px, calc(100vw - 32px))"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          color: 'var(--text-dim)',
          fontSize: '0.88rem',
          lineHeight: 1.45,
        }}
      >
        <p>
          Mormon Bridge is a rummy game for 3–5 players. Lowest score after 7
          rounds wins.
        </p>
        <p style={{ color: 'var(--text)', fontWeight: 600 }}>Each turn</p>
        <p>
          Draw (deck or discard), optionally play cards, then discard. Before
          playing freely, you must go down by laying the round&apos;s required
          sets all at once.
        </p>
        <p>
          After going down, add cards to any sets on the table. Empty your hand
          to end the round. Leftover cards score points against you (1–8 = 5,
          9–14 = 10, wild = 20).
        </p>
        <p style={{ color: 'var(--text)', fontWeight: 600 }}>Sets</p>
        <ul style={{ paddingLeft: '1.1rem', display: 'grid', gap: '4px' }}>
          <li>
            Group: 3+ cards of the same number.
          </li>
          <li>
            Run: 4+ cards of the same color in consecutive order.
          </li>
        </ul>
        <p style={{ color: 'var(--text)', fontWeight: 600 }}>Rounds</p>
        <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '2px' }}>
          <li>2 groups</li>
          <li>1 group + 1 run</li>
          <li>2 runs</li>
          <li>3 groups</li>
          <li>2 groups + 1 run</li>
          <li>1 group + 2 runs</li>
          <li>3 runs</li>
        </ol>
        <p style={{ color: 'var(--text)', fontWeight: 600 }}>Buying</p>
        <p>
          Other players may call &quot;Buy it!&quot; for a discard. If allowed,
          they take it plus a penalty card from the deck.
        </p>
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
        Got it
      </button>
    </ModalShell>
  )
}

function AvatarPickerModal({
  name,
  seat,
  takenIds,
  onAvatarChange,
  onClose,
}: {
  name: string
  seat: SeatDraft
  takenIds: Set<string>
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
