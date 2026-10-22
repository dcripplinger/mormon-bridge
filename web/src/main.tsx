import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as CapApp } from '@capacitor/app'
import './index.css'
import GameScreen from './app/GameScreen'
import HomeScreen from './app/HomeScreen'
import {
  consumeJoinCodeFromLocation,
  parseJoinCodeFromUrl,
} from './app/join-link'
import MenuScreen from './app/MenuScreen'
import OnlineSession, { type OnlineIntent } from './app/OnlineSession'
import {
  clearActiveGame,
  loadActiveGame,
  loadOnlineProfile,
  loadPrefs,
  saveActiveGame,
  type OnlineProfile,
} from './app/persistence'
import type { GameSettings, SeatDraft } from './app/types'
import { createGame } from './game/state'
import type { GameState, PlayerSetup } from './game/state'
import { useApiReachable } from './net/use-api-reachable'

type MenuView = 'home' | 'solo' | 'online'

function App() {
  // True while we're reading prefs/active-game from storage on boot
  const [loading, setLoading] = useState(true)

  // The game currently being played (null = on menu)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [menuView, setMenuView] = useState<MenuView>('home')
  const [onlineIntent, setOnlineIntent] = useState<OnlineIntent>('create')
  const [joinRoomCode, setJoinRoomCode] = useState<string | undefined>()
  /** Join deep link waiting until the multiplayer API is reachable. */
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null)

  // The persisted game shown as "Continue" on the home screen.
  // Updated in-place by a ref during play to avoid causing re-renders.
  const [savedGame, setSavedGame] = useState<GameState | null>(null)
  const savedGameRef = useRef<GameState | null>(null)

  // Restored seat config and settings for the menu
  const [initialSeats, setInitialSeats] = useState<SeatDraft[] | null>(null)
  const [initialSettings, setInitialSettings] = useState<GameSettings | null>(null)
  const [onlineProfile, setOnlineProfile] = useState<OnlineProfile | null>(null)

  const { status: onlineStatus, recheck: recheckOnline } = useApiReachable()

  const openJoinWithCode = useCallback((code: string) => {
    setGameState(null)
    setPendingJoinCode(code)
  }, [])

  // Boot: load prefs, active game, online profile, and any join deep link
  useEffect(() => {
    const fromLocation = consumeJoinCodeFromLocation()
    Promise.all([loadPrefs(), loadActiveGame(), loadOnlineProfile()]).then(
      async ([prefs, activeGame, profile]) => {
        if (prefs) {
          setInitialSeats(prefs.seats)
          setInitialSettings(prefs.settings)
        }
        setOnlineProfile(profile)
        savedGameRef.current = activeGame
        setSavedGame(activeGame)

        let joinCode = fromLocation
        if (!joinCode) {
          try {
            const launch = await CapApp.getLaunchUrl()
            if (launch?.url) joinCode = parseJoinCodeFromUrl(launch.url)
          } catch {
            // Web / unsupported — ignore
          }
        }
        if (joinCode) setPendingJoinCode(joinCode)
        setLoading(false)
      },
    )
  }, [])

  // Open a pending join only when the multiplayer API is reachable.
  useEffect(() => {
    if (!pendingJoinCode) return
    if (onlineStatus === 'checking') return
    if (onlineStatus === 'unavailable') {
      setPendingJoinCode(null)
      return
    }
    setOnlineIntent('join')
    setJoinRoomCode(pendingJoinCode)
    setMenuView('online')
    setPendingJoinCode(null)
  }, [pendingJoinCode, onlineStatus])

  // Warm start / resume: listen for app URL opens (custom scheme + App Links)
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | undefined
    const listen = async () => {
      try {
        handle = await CapApp.addListener('appUrlOpen', ({ url }) => {
          const code = parseJoinCodeFromUrl(url)
          if (code) openJoinWithCode(code)
        })
      } catch {
        // Web — no native listener
      }
    }
    void listen()
    return () => {
      void handle?.remove()
    }
  }, [openJoinWithCode])

  // Called by MenuScreen to start a brand-new game
  const handleStart = useCallback(async (players: PlayerSetup[]) => {
    const newState = createGame(players)
    await saveActiveGame(newState)
    savedGameRef.current = newState
    setSavedGame(newState)
    setGameState(newState)
  }, [])

  // Called by HomeScreen "Continue Game"
  const handleContinue = useCallback(() => {
    if (savedGameRef.current) setGameState(savedGameRef.current)
  }, [])

  // Called by HomeScreen "Start New Game" — clears the save before solo setup
  const handleQuit = useCallback(async () => {
    await clearActiveGame()
    savedGameRef.current = null
    setSavedGame(null)
  }, [])

  // Called by GameScreen on every state change — persists without causing App re-renders
  const handleSave = useCallback((state: GameState) => {
    savedGameRef.current = state
    saveActiveGame(state) // fire-and-forget
  }, [])

  // Called by GameScreen when all 7 rounds finish — clears the save
  const handleGameEnd = useCallback(() => {
    clearActiveGame() // fire-and-forget
    savedGameRef.current = null
    setSavedGame(null)
  }, [])

  // Called by GameScreen "Return to Menu" — keeps the save so Continue appears
  const handleReturnToMenu = useCallback(() => {
    setSavedGame(savedGameRef.current)
    setGameState(null)
    setMenuView('home')
  }, [])

  const refreshOnlineProfile = useCallback(async () => {
    setOnlineProfile(await loadOnlineProfile())
  }, [])

  const openOnline = useCallback((intent: OnlineIntent) => {
    if (onlineStatus !== 'available') return
    void refreshOnlineProfile()
    setOnlineIntent(intent)
    setJoinRoomCode(undefined)
    setMenuView('online')
  }, [onlineStatus, refreshOnlineProfile])

  const returnHomeFromOnline = useCallback(() => {
    setJoinRoomCode(undefined)
    setMenuView('home')
    void refreshOnlineProfile()
    recheckOnline()
  }, [recheckOnline, refreshOnlineProfile])

  if (loading) return null

  if (menuView === 'online') {
    return (
      <OnlineSession
        key={`${onlineIntent}:${joinRoomCode ?? ''}`}
        intent={onlineIntent}
        initialRoomCode={joinRoomCode}
        onBack={returnHomeFromOnline}
        settings={initialSettings ?? undefined}
        defaultDisplayName={onlineProfile?.displayName}
        defaultAvatarId={
          onlineProfile?.avatarId ?? initialSeats?.[0]?.avatarId
        }
      />
    )
  }

  if (gameState) {
    return (
      <GameScreen
        initialState={gameState}
        onReturnToMenu={handleReturnToMenu}
        onSave={handleSave}
        onGameEnd={handleGameEnd}
        settings={initialSettings ?? undefined}
      />
    )
  }

  if (menuView === 'solo') {
    return (
      <MenuScreen
        initialSeats={initialSeats ?? undefined}
        initialSettings={initialSettings ?? undefined}
        onStart={handleStart}
        onBack={() => setMenuView('home')}
      />
    )
  }

  return (
    <HomeScreen
      activeGame={savedGame}
      onSoloSetup={() => setMenuView('solo')}
      onContinue={handleContinue}
      onQuit={handleQuit}
      onCreateOnline={() => openOnline('create')}
      onJoinOnline={() => openOnline('join')}
      onlineStatus={onlineStatus}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
