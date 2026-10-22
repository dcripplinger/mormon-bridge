import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import {
  clearOnlineReconnect,
  loadOnlineReconnect,
  saveOnlineProfile,
  saveOnlineReconnect,
  type OnlineReconnect,
} from './persistence'
import {
  RECONNECTED_ELSEWHERE,
  buildGuestOpenUrl,
  clearSessionReconnect,
  formatKickReason,
  guestDisplayName,
  isDevGuestMode,
  loadSessionReconnect,
  nextGuestId,
  readGuestParam,
  saveSessionReconnect,
} from './online-guest'
import type { GameSettings } from './types'
import { actionToClientMessage } from '../net/action-to-message'
import { clientViewToGameState } from '../net/client-view-state'
import {
  ApiUnreachableError,
  RoomClient,
  checkApiReachable,
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

function readGuestFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  if (!isDevGuestMode(import.meta.env.DEV, window.location.search)) return null
  return readGuestParam(window.location.search)
}

/** Prod: Preferences (+ one-time sessionStorage migrate). Guest: session only. */
async function loadReconnect(isGuest: boolean): Promise<OnlineReconnect | null> {
  if (isGuest) return loadSessionReconnect()
  const durable = await loadOnlineReconnect()
  if (durable) return durable
  const legacy = loadSessionReconnect()
  if (!legacy) return null
  await saveOnlineReconnect(legacy)
  clearSessionReconnect()
  return legacy
}

async function saveReconnect(isGuest: boolean, data: OnlineReconnect): Promise<void> {
  if (isGuest) {
    saveSessionReconnect(data)
    return
  }
  await saveOnlineReconnect(data)
}

async function clearReconnect(isGuest: boolean): Promise<void> {
  if (isGuest) {
    clearSessionReconnect()
    return
  }
  await clearOnlineReconnect()
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
  const guestParam = useMemo(() => readGuestFromLocation(), [])
  const isGuest = guestParam !== null
  const [mode, setMode] = useState<Mode>('menu')
  const [error, setError] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState(() =>
    initialRoomCode ? normalizeRoomCode(initialRoomCode) : '',
  )
  const [displayName, setDisplayName] = useState(() =>
    isGuest ? guestDisplayName(guestParam) : defaultDisplayName,
  )
  const [avatarId, setAvatarId] = useState(() =>
    isGuest ? pickFreeAvatar('human', []) : initialAvatarId(defaultAvatarId),
  )
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [room, setRoom] = useState<RoomPublicState | null>(null)
  const [seatIndex, setSeatIndex] = useState<number | null>(null)
  const [view, setView] = useState<ClientView | null>(null)
  const [ready, setReady] = useState(false)
  const [tableSize, setTableSize] = useState(DEFAULT_TABLE_SIZE)
  const [codeFeedback, setCodeFeedback] = useState<string | null>(null)
  const [connectionLost, setConnectionLost] = useState(false)

  const clientRef = useRef<RoomClient | null>(null)
  const connectionLostRef = useRef(false)
  const isGuestRef = useRef(isGuest)
  isGuestRef.current = isGuest
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName
  const avatarIdRef = useRef(avatarId)
  avatarIdRef.current = avatarId
  const roomCodeRef = useRef(roomCode)
  roomCodeRef.current = roomCode
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rejoinInFlightRef = useRef(false)
  /** If set, send setReady after a successful re-join (session recovery). */
  const pendingReadyRef = useRef<boolean | null>(null)

  const reportConnectionLost = useCallback(() => {
    if (connectionLostRef.current) return
    connectionLostRef.current = true
    clientRef.current?.close({ silent: true })
    clientRef.current = null
    setConnectionLost(true)
  }, [])

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
    if (isGuestRef.current) return
    const trimmed = name.trim()
    if (!trimmed) return
    void saveOnlineProfile({ displayName: trimmed, avatarId: nextAvatarId })
  }, [])

  const rejoinWithToken = useCallback(async () => {
    if (rejoinInFlightRef.current || connectionLostRef.current) return
    const client = clientRef.current
    const code = normalizeRoomCode(roomCodeRef.current)
    if (!client || !code) return
    rejoinInFlightRef.current = true
    try {
      const stored = await loadReconnect(isGuestRef.current)
      const token =
        stored && stored.roomCode === code ? stored.reconnectToken : undefined
      client.send({
        type: 'join',
        displayName: displayNameRef.current.trim() || 'Player',
        avatarId: avatarIdRef.current,
        reconnectToken: token,
      })
    } finally {
      window.setTimeout(() => {
        rejoinInFlightRef.current = false
      }, 2000)
    }
  }, [])

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setSeatIndex(msg.seatIndex)
        setRoomCode(msg.roomCode)
        rejoinInFlightRef.current = false
        void saveReconnect(isGuestRef.current, {
          roomCode: msg.roomCode,
          reconnectToken: msg.reconnectToken,
          displayName: displayNameRef.current,
          avatarId: avatarIdRef.current,
        })
        persistProfile(displayNameRef.current, avatarIdRef.current)
        setMode('lobby')
        setError(null)
        if (pendingReadyRef.current !== null) {
          const readyValue = pendingReadyRef.current
          pendingReadyRef.current = null
          setReady(readyValue)
          clientRef.current?.send({ type: 'setReady', ready: readyValue })
        }
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
        // Session binding can be lost after DO hibernation; re-join with token.
        if (msg.message === 'Join the room first') {
          void rejoinWithToken()
          return
        }
        setError(msg.message)
        break
      case 'kicked':
        setError(formatKickReason(msg.reason))
        // Do not clear shared Preferences on takeover — the other tab owns the seat.
        if (msg.reason !== RECONNECTED_ELSEWHERE) {
          void clearReconnect(isGuestRef.current)
        }
        clientRef.current?.close({ silent: true })
        clientRef.current = null
        setMode('menu')
        setRoom(null)
        setView(null)
        break
      case 'roomClosed':
        setError('Room closed')
        void clearReconnect(isGuestRef.current)
        clientRef.current?.close({ silent: true })
        clientRef.current = null
        setMode('menu')
        break
      default:
        break
    }
  }, [persistProfile, rejoinWithToken])

  useEffect(() => {
    if (seatIndex === null || !room) return
    const mine = room.seats.find((s) => s.seatIndex === seatIndex)
    if (!mine) return
    setReady(mine.ready)
    if (pendingReadyRef.current === mine.ready) {
      pendingReadyRef.current = null
    }
  }, [room, seatIndex])

  const connectAndJoinReliable = useCallback((
    code: string,
    reconnectToken?: string,
  ) => {
    if (connectionLostRef.current) return
    setError(null)
    clientRef.current?.close({ silent: true })
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
          return
        }
        if (s === 'error' || s === 'closed') {
          reportConnectionLost()
        }
      },
    })
    clientRef.current = client
    client.connect(roomWebSocketUrl(apiBase, code))
  }, [apiBase, handleServerMessage, reportConnectionLost])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await loadReconnect(isGuest)
      if (cancelled || !stored || connectionLostRef.current) return
      const deepLinkCode = initialRoomCode ? normalizeRoomCode(initialRoomCode) : ''
      // Deep link to a different room → show join form, do not auto-reconnect.
      if (deepLinkCode && deepLinkCode !== stored.roomCode) return
      setDisplayName(stored.displayName)
      setAvatarId(initialAvatarId(stored.avatarId))
      setRoomCode(stored.roomCode)
      connectAndJoinReliable(stored.roomCode, stored.reconnectToken)
    })()
    return () => {
      cancelled = true
    }
    // once on mount for refresh reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    clientRef.current?.close({ silent: true })
    clientRef.current = null
  }, [])

  // Browser offline, or lost API while still on create/join menus.
  useEffect(() => {
    if (connectionLost) return
    const onOffline = () => reportConnectionLost()
    window.addEventListener('offline', onOffline)
    return () => window.removeEventListener('offline', onOffline)
  }, [connectionLost, reportConnectionLost])

  useEffect(() => {
    if (connectionLost || mode !== 'menu') return
    let cancelled = false
    const tick = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelled) reportConnectionLost()
        return
      }
      const ok = await checkApiReachable(apiBase)
      if (!cancelled && !ok) reportConnectionLost()
    }
    const id = window.setInterval(() => void tick(), 12_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [apiBase, connectionLost, mode, reportConnectionLost])

  const handleCreate = async () => {
    setError(null)
    persistProfile(displayName, avatarId)
    try {
      const { roomCode: code } = await createRoom(apiBase, tableSize)
      setRoomCode(code)
      connectAndJoinReliable(code)
    } catch (e) {
      if (e instanceof ApiUnreachableError) {
        reportConnectionLost()
        return
      }
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

  const openGuestTab = () => {
    if (!import.meta.env.DEV) return
    const url = buildGuestOpenUrl(
      window.location.href,
      nextGuestId(guestParam),
      roomCode || undefined,
    )
    window.open(url, '_blank', 'noopener,noreferrer')
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
    pendingReadyRef.current = next
    clientRef.current?.send({ type: 'setReady', ready: next })
  }

  const startGame = () => {
    clientRef.current?.send({ type: 'startGame' })
  }

  const changeTableSize = (size: number) => {
    setTableSize(size)
    clientRef.current?.send({ type: 'setTableSize', tableSize: size })
  }

  const setSeatBot = (targetSeatIndex: number, isBot: boolean) => {
    clientRef.current?.send(
      isBot
        ? { type: 'addBot', seatIndex: targetSeatIndex }
        : { type: 'removeBot', seatIndex: targetSeatIndex },
    )
  }

  const leave = () => {
    clientRef.current?.send({ type: 'leave' })
    clientRef.current?.close({ silent: true })
    clientRef.current = null
    void clearReconnect(isGuest)
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

  const withConnectionLost = (node: ReactNode) => (
    <>
      {node}
      {connectionLost && <ConnectionLostModal onClose={onBack} />}
    </>
  )

  if (mode === 'playing' && shadowState && seatIndex !== null) {
    return withConnectionLost(
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
      />,
    )
  }

  if (mode === 'lobby' && room) {
    const isHost = seatIndex === room.hostSeatIndex
    const humans = room.seats.filter((s) => !s.isOpen && !s.isAI)
    const canStart =
      isHost
      && humans.length >= 1
      && humans.every((s) => s.ready)

    return withConnectionLost(
      <div className="setup-shell setup-shell--lobby">
        <div className="setup-shell__scroll scroll-hide">
          <div className="setup-shell__panel setup-shell__panel--header">
            {isHost ? (
              <>
                <div className="setup-code-block">
                  <div className="setup-code-block__main">
                    <span className="setup-code-block__label">Room code:</span>
                    <div
                      className="setup-code-block__code"
                      aria-label={`Room code ${room.roomCode}`}
                    >
                      {room.roomCode}
                    </div>
                  </div>
                  <div className="setup-code-block__actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--slim"
                      onClick={() => void handleCopyCode(room.roomCode)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary btn--slim"
                      onClick={() => void handleShareCode(room.roomCode)}
                    >
                      Share
                    </button>
                  </div>
                  {codeFeedback && (
                    <p className="setup-shell__lede" style={{ fontSize: 13 }}>
                      {codeFeedback}
                    </p>
                  )}
                </div>
                <label className="field" style={{ maxWidth: 'none' }}>
                  Table size
                  <select
                    value={room.tableSize}
                    onChange={(e) => changeTableSize(Number(e.target.value))}
                    className="field__control"
                  >
                    {Array.from(
                      { length: room.maxPlayers - room.minPlayers + 1 },
                      (_, i) => room.minPlayers + i,
                    ).map((n) => (
                      <option key={n} value={n}>{n} seats</option>
                    ))}
                  </select>
                </label>
                <p className="setup-shell__lede" style={{ fontSize: 13 }}>
                  Open seats become bots when you start.
                </p>
              </>
            ) : (
              <p className="setup-shell__lede">
                Table of {room.tableSize}. Waiting for the host to start.
              </p>
            )}
          </div>

          <ul className="setup-seat-list setup-shell__panel setup-shell__panel--seats">
            {room.seats.map((s) => {
              const isHuman = !s.isOpen && !s.isAI
              const showBotToggle = isHost && (s.isOpen || s.isAI)
              const isSelf = s.seatIndex === seatIndex
              return (
                <li key={s.seatIndex} className="setup-seat-list__item">
                  {s.isOpen ? (
                    <div className="setup-seat-list__open-avatar" />
                  ) : (
                    <AvatarView avatarId={s.avatarId} size={40} />
                  )}
                  <div className="setup-seat-list__meta">
                    <div
                      className={`setup-seat-list__name${s.isOpen ? ' setup-seat-list__name--open' : ''}`}
                    >
                      {s.isOpen
                        ? 'Open seat'
                        : s.displayName}
                      {isSelf ? ' (you)' : ''}
                      {isHuman && s.seatIndex === room.hostSeatIndex ? ' · host' : ''}
                    </div>
                    <div className="setup-seat-list__status">
                      {s.isOpen
                        ? 'waiting for player'
                        : s.isAI
                          ? 'bot'
                          : s.connected
                            ? 'connected'
                            : 'disconnected'}
                    </div>
                  </div>
                  {showBotToggle && (
                    <label className="setup-seat-list__check">
                      <input
                        type="checkbox"
                        checked={s.isAI}
                        onChange={(e) => setSeatBot(s.seatIndex, e.target.checked)}
                      />
                      Bot
                    </label>
                  )}
                  {isHuman && (
                    <label
                      className={`setup-seat-list__check${isSelf ? '' : ' setup-seat-list__check--readonly'}`}
                    >
                      <input
                        type="checkbox"
                        checked={s.ready}
                        disabled={!isSelf}
                        onChange={() => {
                          if (isSelf) toggleReady()
                        }}
                      />
                      Ready
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', margin: '8px 0 0', textAlign: 'center' }}>
            {error}
          </p>
        )}
        <div className="setup-shell__actions">
          {isHost && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startGame}
              disabled={!canStart}
            >
              Start game
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={leave}>
            Leave
          </button>
          {import.meta.env.DEV && (
            <button type="button" className="btn btn--ghost" onClick={openGuestTab}>
              Open guest tab
            </button>
          )}
        </div>
      </div>,
    )
  }

  const isCreate = intent === 'create'
  const nameLabel = displayName.trim() || 'You'

  return withConnectionLost(
    <div className="setup-shell">
      <div className="setup-shell__scroll scroll-hide">
        <div className="setup-shell__panel">
          <h1 className="setup-shell__title">
            {isCreate ? 'Create Online Game' : 'Join Online Game'}
          </h1>
          <p className="setup-shell__lede">
            {isCreate
              ? 'Create a private room. You will get a short code to share with friends.'
              : 'Enter the room code shared by the host.'}
          </p>
          {isGuest && (
            <p className="setup-shell__lede" style={{ fontSize: 13 }}>
              Dev guest tab — identity stays in this tab only.
            </p>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              width: '100%',
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
            <label className="field" style={{ flex: 1, maxWidth: 'none' }}>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="field__control"
                autoComplete="nickname"
              />
            </label>
          </div>

          {!isCreate && (
            <label className="field" style={{ maxWidth: 'none' }}>
              Room code
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABCD12"
                className="field__control"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          )}
          {isCreate && (
            <label className="field" style={{ maxWidth: 'none' }}>
              Table size
              <select
                value={tableSize}
                onChange={(e) => setTableSize(Number(e.target.value))}
                className="field__control"
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
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--danger)', margin: '8px 0 0', textAlign: 'center' }}>
          {error}
        </p>
      )}
      <div className="setup-shell__actions">
        {isCreate ? (
          <button type="button" className="btn btn--primary" onClick={() => void handleCreate()}>
            Create room
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={handleJoin}>
            Join room
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back
        </button>
        {import.meta.env.DEV && (
          <button type="button" className="btn btn--ghost" onClick={openGuestTab}>
            Open guest tab
          </button>
        )}
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
    </div>,
  )
}

function ConnectionLostModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        aria-label="Dismiss connection lost dialog"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          border: 'none',
          padding: 0,
          zIndex: 80,
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connection lost"
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
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1.05rem' }}>
          Connection lost
        </div>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.4 }}>
          Lost connection to the game server. You can keep playing single player, or try online
          again when you are back online.
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          Return to menu
        </button>
      </div>
    </>
  )
}


