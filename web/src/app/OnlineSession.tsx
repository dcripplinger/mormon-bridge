import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_TABLE_SIZE,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  normalizeRoomCode,
  type ClientView,
  type RoomPublicState,
  type ServerMessage,
} from '@mormon-bridge/shared'
import { Share } from '@capacitor/share'
import { getAvatar, pickFreeAvatar } from '../avatars/catalog'
import AvatarPickerModal from '../ui/AvatarPickerModal'
import AvatarView from '../ui/AvatarView'
import GameScreen, { type GameScreenAction } from './GameScreen'
import {
  buildShareJoinUrl,
  buildWebJoinUrl,
} from './join-link'
import { saveOnlineProfile } from './persistence'
import type { GameSettings } from './types'
import { actionToClientMessage } from '../net/action-to-message'
import { clientViewToGameState } from '../net/client-view-state'
import {
  RoomClient,
  createRoom,
  defaultApiBase,
  roomWebSocketUrl,
} from '../net/room-client'

type Mode = 'menu' | 'lobby' | 'playing'

export type OnlineIntent = 'create' | 'join'

interface Props {
  intent: OnlineIntent
  onBack: () => void
  settings?: GameSettings
  defaultDisplayName?: string
  defaultAvatarId?: string
  /** Prefill join form (e.g. from a share / deep link). */
  initialRoomCode?: string
}

const RECONNECT_KEY = 'mb:online-reconnect'

interface StoredReconnect {
  roomCode: string
  reconnectToken: string
  displayName: string
  avatarId: string
}

function loadReconnect(): StoredReconnect | null {
  try {
    const raw = sessionStorage.getItem(RECONNECT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredReconnect>
    if (
      typeof parsed.roomCode !== 'string'
      || typeof parsed.reconnectToken !== 'string'
      || typeof parsed.displayName !== 'string'
      || typeof parsed.avatarId !== 'string'
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

function saveReconnect(data: StoredReconnect): void {
  sessionStorage.setItem(RECONNECT_KEY, JSON.stringify(data))
}

function clearReconnect(): void {
  sessionStorage.removeItem(RECONNECT_KEY)
}

function inviteText(roomCode: string): string {
  const webUrl = buildWebJoinUrl(roomCode)
  return `Join my Mormon Bridge game! Room code: ${roomCode}\n${webUrl}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Native/web share sheet when available; otherwise copy the invite text. */
async function shareRoomInvite(roomCode: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const text = inviteText(roomCode)
  const url = buildShareJoinUrl(roomCode)
  try {
    if ((await Share.canShare()).value) {
      try {
        await Share.share({
          title: 'Mormon Bridge',
          text,
          url,
          dialogTitle: 'Share room code',
        })
        return 'shared'
      } catch {
        return 'cancelled'
      }
    }
  } catch {
    // Plugin unavailable; fall through to clipboard.
  }

  const ok = await copyText(text)
  return ok ? 'copied' : 'cancelled'
}

function initialAvatarId(defaultAvatarId?: string): string {
  if (defaultAvatarId && getAvatar(defaultAvatarId)?.kind === 'human') {
    return defaultAvatarId
  }
  return pickFreeAvatar('human', [])
}

export default function OnlineSession({
  intent,
  onBack,
  settings,
  defaultDisplayName = 'You',
  defaultAvatarId,
  initialRoomCode,
}: Props) {
  const apiBase = defaultApiBase()
  const [mode, setMode] = useState<Mode>('menu')
  const [error, setError] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState(() =>
    initialRoomCode ? normalizeRoomCode(initialRoomCode) : '',
  )
  const [displayName, setDisplayName] = useState(defaultDisplayName)
  const [avatarId, setAvatarId] = useState(() => initialAvatarId(defaultAvatarId))
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [room, setRoom] = useState<RoomPublicState | null>(null)
  const [seatIndex, setSeatIndex] = useState<number | null>(null)
  const [view, setView] = useState<ClientView | null>(null)
  const [ready, setReady] = useState(false)
  const [tableSize, setTableSize] = useState(DEFAULT_TABLE_SIZE)
  const [codeFeedback, setCodeFeedback] = useState<string | null>(null)

  const clientRef = useRef<RoomClient | null>(null)
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName
  const avatarIdRef = useRef(avatarId)
  avatarIdRef.current = avatarId
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showCodeFeedback = useCallback((message: string) => {
    setCodeFeedback(message)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setCodeFeedback(null), 2000)
  }, [])

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    if (!avatarPickerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAvatarPickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [avatarPickerOpen])

  const persistProfile = useCallback((name: string, nextAvatarId: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    void saveOnlineProfile({ displayName: trimmed, avatarId: nextAvatarId })
  }, [])

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setSeatIndex(msg.seatIndex)
        setRoomCode(msg.roomCode)
        saveReconnect({
          roomCode: msg.roomCode,
          reconnectToken: msg.reconnectToken,
          displayName: displayNameRef.current,
          avatarId: avatarIdRef.current,
        })
        persistProfile(displayNameRef.current, avatarIdRef.current)
        setMode('lobby')
        setError(null)
        break
      case 'roomState':
        setRoom(msg.room)
        setTableSize(msg.room.tableSize)
        if (msg.room.phase === 'playing') setMode('playing')
        break
      case 'clientView':
        setView(msg.view)
        setMode('playing')
        break
      case 'error':
        setError(msg.message)
        break
      case 'kicked':
        setError(msg.reason)
        clearReconnect()
        clientRef.current?.close()
        setMode('menu')
        setRoom(null)
        setView(null)
        break
      case 'roomClosed':
        setError('Room closed')
        clearReconnect()
        setMode('menu')
        break
      default:
        break
    }
  }, [persistProfile])

  useEffect(() => {
    if (seatIndex === null || !room) return
    const mine = room.seats.find((s) => s.seatIndex === seatIndex)
    if (mine) setReady(mine.ready)
  }, [room, seatIndex])

  const connectAndJoinReliable = useCallback((
    code: string,
    reconnectToken?: string,
  ) => {
    setError(null)
    clientRef.current?.close()
    const client = new RoomClient({
      onMessage: handleServerMessage,
      onStatus: (s) => {
        if (s === 'open') {
          client.send({
            type: 'join',
            displayName: displayNameRef.current.trim() || 'Player',
            avatarId: avatarIdRef.current,
            reconnectToken,
          })
        }
        if (s === 'error') setError('Connection failed')
      },
    })
    clientRef.current = client
    client.connect(roomWebSocketUrl(apiBase, code))
  }, [apiBase, handleServerMessage])

  useEffect(() => {
    const stored = loadReconnect()
    if (!stored) return
    const deepLinkCode = initialRoomCode ? normalizeRoomCode(initialRoomCode) : ''
    // Deep link to a different room → show join form, do not auto-reconnect.
    if (deepLinkCode && deepLinkCode !== stored.roomCode) return
    setDisplayName(stored.displayName)
    setAvatarId(initialAvatarId(stored.avatarId))
    setRoomCode(stored.roomCode)
    connectAndJoinReliable(stored.roomCode, stored.reconnectToken)
    // once on mount for refresh reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    clientRef.current?.close()
  }, [])

  const handleCreate = async () => {
    setError(null)
    persistProfile(displayName, avatarId)
    try {
      const { roomCode: code } = await createRoom(apiBase, tableSize)
      setRoomCode(code)
      connectAndJoinReliable(code)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    }
  }

  const handleJoin = () => {
    const code = normalizeRoomCode(roomCode)
    if (code.length < 4) {
      setError('Enter a room code')
      return
    }
    persistProfile(displayName, avatarId)
    connectAndJoinReliable(code)
  }

  const handleCopyCode = async (code: string) => {
    const ok = await copyText(code)
    showCodeFeedback(ok ? 'Code copied' : 'Could not copy')
  }

  const handleShareCode = async (code: string) => {
    const result = await shareRoomInvite(code)
    if (result === 'copied') showCodeFeedback('Invite copied')
  }

  const toggleReady = () => {
    const next = !ready
    setReady(next)
    clientRef.current?.send({ type: 'setReady', ready: next })
  }

  const startGame = () => {
    clientRef.current?.send({ type: 'startGame' })
  }

  const changeTableSize = (size: number) => {
    setTableSize(size)
    clientRef.current?.send({ type: 'setTableSize', tableSize: size })
  }

  const addBot = () => {
    clientRef.current?.send({ type: 'addBot' })
  }

  const removeBot = () => {
    clientRef.current?.send({ type: 'removeBot' })
  }

  const leave = () => {
    clientRef.current?.send({ type: 'leave' })
    clientRef.current?.close()
    clearReconnect()
    setMode('menu')
    setRoom(null)
    setView(null)
    setSeatIndex(null)
    setReady(false)
    onBack()
  }

  const onControlledAction = useCallback((action: GameScreenAction) => {
    const msg = actionToClientMessage(action)
    if (msg) clientRef.current?.send(msg)
  }, [])

  const shadowState = useMemo(
    () => (view ? clientViewToGameState(view) : null),
    [view],
  )

  if (mode === 'playing' && shadowState && seatIndex !== null) {
    return (
      <GameScreen
        initialState={shadowState}
        controlledState={shadowState}
        onControlledAction={onControlledAction}
        humanSeatIndex={seatIndex}
        skipBots
        skipPersistence
        onReturnToMenu={leave}
        onSave={() => {}}
        onGameEnd={() => {}}
        settings={settings}
      />
    )
  }

  if (mode === 'lobby' && room) {
    const isHost = seatIndex === room.hostSeatIndex
    const humans = room.seats.filter((s) => !s.isOpen && !s.isAI)
    const openCount = room.seats.filter((s) => s.isOpen).length
    const botCount = room.seats.filter((s) => s.isAI).length
    const canStart =
      isHost
      && humans.length >= 1
      && humans.every((s) => s.ready)

    return (
      <div style={shellStyle}>
        <h1 style={{ margin: 0 }}>Room {room.roomCode}</h1>
        {isHost && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              maxWidth: 360,
            }}
          >
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '1.75rem',
                fontWeight: 700,
                letterSpacing: '0.18em',
                color: 'var(--text)',
              }}
            >
              {room.roomCode}
            </div>
            <p style={{ margin: 0, opacity: 0.8, textAlign: 'center', fontSize: 14 }}>
              Share this code with friends. Anyone with the code can join.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={() => void handleCopyCode(room.roomCode)}>
                Copy code
              </button>
              <button type="button" onClick={() => void handleShareCode(room.roomCode)}>
                Share
              </button>
            </div>
            {codeFeedback && (
              <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>{codeFeedback}</p>
            )}
          </div>
        )}
        {!isHost && (
          <p style={{ margin: 0, opacity: 0.8 }}>
            Table of {room.tableSize} ({room.minPlayers}–{room.maxPlayers}).
            Open seats become bots when the host starts.
          </p>
        )}
        {isHost && (
          <>
            <p style={{ margin: 0, opacity: 0.8, textAlign: 'center', maxWidth: 360 }}>
              Table of {room.tableSize} ({room.minPlayers}–{room.maxPlayers}).
              Open seats become bots when you start.
            </p>
            <label style={labelStyle}>
              Table size
              <select
                value={room.tableSize}
                onChange={(e) => changeTableSize(Number(e.target.value))}
                style={inputStyle}
              >
                {Array.from(
                  { length: room.maxPlayers - room.minPlayers + 1 },
                  (_, i) => room.minPlayers + i,
                ).map((n) => (
                  <option key={n} value={n}>{n} seats</option>
                ))}
              </select>
            </label>
          </>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, width: '100%', maxWidth: 360 }}>
          {room.seats.map((s) => (
            <li
              key={s.seatIndex}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 0',
                borderBottom: '1px solid rgba(0,0,0,0.08)',
                opacity: s.isOpen ? 0.55 : 1,
              }}
            >
              {s.isOpen ? (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: '1px dashed rgba(0,0,0,0.25)',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <AvatarView avatarId={s.avatarId} size={40} />
              )}
              <div style={{ flex: 1 }}>
                <div>
                  {s.isOpen
                    ? 'Open seat'
                    : s.displayName}
                  {!s.isOpen && s.seatIndex === seatIndex ? ' (you)' : ''}
                  {!s.isOpen && s.seatIndex === room.hostSeatIndex ? ' · host' : ''}
                  {s.isAI ? ' · bot' : ''}
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {s.isOpen
                    ? 'waiting for player or bot'
                    : s.isAI
                      ? 'bot'
                      : `${s.connected ? 'connected' : 'disconnected'}${s.ready ? ' · ready' : ''}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {error && <p style={{ color: '#b33', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" onClick={toggleReady}>
            {ready ? 'Unready' : 'Ready'}
          </button>
          {isHost && (
            <>
              <button type="button" onClick={addBot} disabled={openCount === 0}>
                Add bot
              </button>
              <button type="button" onClick={removeBot} disabled={botCount === 0}>
                Remove bot
              </button>
              <button type="button" onClick={startGame} disabled={!canStart}>
                Start game
              </button>
            </>
          )}
          <button type="button" onClick={leave}>Leave</button>
        </div>
      </div>
    )
  }

  const isCreate = intent === 'create'
  const nameLabel = displayName.trim() || 'You'

  return (
    <div style={shellStyle}>
      <h1 style={{ margin: 0 }}>
        {isCreate ? 'Create Online Game' : 'Join Online Game'}
      </h1>
      <p style={{ margin: 0, opacity: 0.8, maxWidth: 360, textAlign: 'center' }}>
        {isCreate
          ? 'Create a private room. You will get a short code to share with friends.'
          : 'Enter the room code shared by the host.'}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          width: '100%',
          maxWidth: 320,
        }}
      >
        <button
          type="button"
          onClick={() => setAvatarPickerOpen(true)}
          aria-label="Change avatar"
          style={{
            background: 'transparent',
            border: '2px solid var(--border)',
            borderRadius: '50%',
            padding: 2,
            lineHeight: 0,
            flexShrink: 0,
          }}
        >
          <AvatarView avatarId={avatarId} size={56} alt="" />
        </button>
        <label style={{ ...labelStyle, flex: 1, maxWidth: 'none' }}>
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={inputStyle}
            autoComplete="nickname"
          />
        </label>
      </div>

      {!isCreate && (
        <label style={labelStyle}>
          Room code
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="ABCD12"
            style={inputStyle}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      )}
      {isCreate && (
        <label style={labelStyle}>
          Table size
          <select
            value={tableSize}
            onChange={(e) => setTableSize(Number(e.target.value))}
            style={inputStyle}
          >
            {Array.from(
              { length: MAX_ROOM_PLAYERS - MIN_ROOM_PLAYERS + 1 },
              (_, i) => MIN_ROOM_PLAYERS + i,
            ).map((n) => (
              <option key={n} value={n}>{n} seats</option>
            ))}
          </select>
        </label>
      )}
      {error && <p style={{ color: '#b33', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {isCreate ? (
          <button type="button" onClick={() => void handleCreate()}>Create room</button>
        ) : (
          <button type="button" onClick={handleJoin}>Join room</button>
        )}
        <button type="button" onClick={onBack}>Back</button>
      </div>

      {avatarPickerOpen && (
        <AvatarPickerModal
          name={nameLabel}
          kind="human"
          avatarId={avatarId}
          onAvatarChange={setAvatarId}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </div>
  )
}

const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 16,
  padding: 24,
  boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
  maxWidth: 320,
  fontSize: 14,
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 16,
}
