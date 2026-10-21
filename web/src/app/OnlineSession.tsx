import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  ClientView,
  RoomPublicState,
  ServerMessage,
} from '@mormon-bridge/shared'
import { pickFreeAvatar } from '../avatars/catalog'
import AvatarView from '../ui/AvatarView'
import GameScreen, { type GameScreenAction } from './GameScreen'
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

interface Props {
  onBack: () => void
  settings?: GameSettings
  defaultDisplayName?: string
  defaultAvatarId?: string
}

const RECONNECT_KEY = 'mb:online-reconnect'

interface StoredReconnect {
  roomCode: string
  password: string
  reconnectToken: string
  displayName: string
  avatarId: string
}

function loadReconnect(): StoredReconnect | null {
  try {
    const raw = sessionStorage.getItem(RECONNECT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredReconnect
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

export default function OnlineSession({
  onBack,
  settings,
  defaultDisplayName = 'You',
  defaultAvatarId,
}: Props) {
  const apiBase = defaultApiBase()
  const [mode, setMode] = useState<Mode>('menu')
  const [error, setError] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(defaultDisplayName)
  const [avatarId] = useState(
    () => defaultAvatarId ?? pickFreeAvatar('human', []),
  )
  const [room, setRoom] = useState<RoomPublicState | null>(null)
  const [seatIndex, setSeatIndex] = useState<number | null>(null)
  const [view, setView] = useState<ClientView | null>(null)
  const [ready, setReady] = useState(false)

  const clientRef = useRef<RoomClient | null>(null)
  const passwordRef = useRef(password)
  passwordRef.current = password
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName
  const avatarIdRef = useRef(avatarId)
  avatarIdRef.current = avatarId

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setSeatIndex(msg.seatIndex)
        setRoomCode(msg.roomCode)
        saveReconnect({
          roomCode: msg.roomCode,
          password: passwordRef.current,
          reconnectToken: msg.reconnectToken,
          displayName: displayNameRef.current,
          avatarId: avatarIdRef.current,
        })
        setMode('lobby')
        setError(null)
        break
      case 'roomState':
        setRoom(msg.room)
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
  }, [])

  useEffect(() => {
    if (seatIndex === null || !room) return
    const mine = room.seats.find((s) => s.seatIndex === seatIndex)
    if (mine) setReady(mine.ready)
  }, [room, seatIndex])

  const connectAndJoinReliable = useCallback((
    code: string,
    pass: string,
    reconnectToken?: string,
  ) => {
    setError(null)
    setPassword(pass)
    passwordRef.current = pass
    clientRef.current?.close()
    const client = new RoomClient({
      onMessage: handleServerMessage,
      onStatus: (s) => {
        if (s === 'open') {
          client.send({
            type: 'join',
            password: pass,
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
    setDisplayName(stored.displayName)
    setRoomCode(stored.roomCode)
    setPassword(stored.password)
    connectAndJoinReliable(stored.roomCode, stored.password, stored.reconnectToken)
    // once on mount for refresh reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    clientRef.current?.close()
  }, [])

  const handleCreate = async () => {
    setError(null)
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    try {
      const { roomCode: code } = await createRoom(apiBase, password)
      setRoomCode(code)
      connectAndJoinReliable(code, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    }
  }

  const handleJoin = () => {
    if (!roomCode.trim()) {
      setError('Enter a room code')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    connectAndJoinReliable(roomCode.trim().toUpperCase(), password)
  }

  const toggleReady = () => {
    const next = !ready
    setReady(next)
    clientRef.current?.send({ type: 'setReady', ready: next })
  }

  const startGame = () => {
    clientRef.current?.send({ type: 'startGame' })
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
    const canStart =
      isHost
      && room.seats.length >= room.minPlayers
      && room.seats.every((s) => s.ready)

    return (
      <div style={shellStyle}>
        <h1 style={{ margin: 0 }}>Room {room.roomCode}</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Share the code and password with friends. Need {room.minPlayers}–
          {room.maxPlayers} players.
        </p>
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
              }}
            >
              <AvatarView avatarId={s.avatarId} size={40} />
              <div style={{ flex: 1 }}>
                <div>
                  {s.displayName}
                  {s.seatIndex === seatIndex ? ' (you)' : ''}
                  {s.seatIndex === room.hostSeatIndex ? ' · host' : ''}
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {s.connected ? 'connected' : 'disconnected'}
                  {s.ready ? ' · ready' : ''}
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
            <button type="button" onClick={startGame} disabled={!canStart}>
              Start game
            </button>
          )}
          <button type="button" onClick={leave}>Leave</button>
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <h1 style={{ margin: 0 }}>Online private room</h1>
      <p style={{ margin: 0, opacity: 0.8, maxWidth: 360, textAlign: 'center' }}>
        Create a room or join with a code and password. No public matchmaking.
      </p>
      <label style={labelStyle}>
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Room code (join)
        <input
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          placeholder="ABCD12"
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
      </label>
      {error && <p style={{ color: '#b33', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" onClick={handleCreate}>Create room</button>
        <button type="button" onClick={handleJoin}>Join room</button>
        <button type="button" onClick={onBack}>Back</button>
      </div>
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
