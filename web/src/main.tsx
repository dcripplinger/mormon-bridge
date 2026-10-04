import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import GameScreen from './app/GameScreen'
import MenuScreen from './app/MenuScreen'
import {
  clearActiveGame,
  loadActiveGame,
  loadPrefs,
  saveActiveGame,
} from './app/persistence'
import type { GameSettings, SeatDraft } from './app/types'
import { createGame } from './game/state'
import type { GameState, PlayerSetup } from './game/state'

function App() {
  // True while we're reading prefs/active-game from storage on boot
  const [loading, setLoading] = useState(true)

  // The game currently being played (null = on menu)
  const [gameState, setGameState] = useState<GameState | null>(null)

  // The persisted game shown as "Continue" on the menu.
  // Updated in-place by a ref during play to avoid causing re-renders.
  const [savedGame, setSavedGame] = useState<GameState | null>(null)
  const savedGameRef = useRef<GameState | null>(null)

  // Restored seat config and settings for the menu
  const [initialSeats, setInitialSeats] = useState<SeatDraft[] | null>(null)
  const [initialSettings, setInitialSettings] = useState<GameSettings | null>(null)

  // Boot: load prefs and any active game from storage
  useEffect(() => {
    Promise.all([loadPrefs(), loadActiveGame()]).then(([prefs, activeGame]) => {
      if (prefs) {
        setInitialSeats(prefs.seats)
        setInitialSettings(prefs.settings)
      }
      savedGameRef.current = activeGame
      setSavedGame(activeGame)
      setLoading(false)
    })
  }, [])

  // Called by MenuScreen to start a brand-new game
  const handleStart = useCallback(async (players: PlayerSetup[]) => {
    const newState = createGame(players)
    await saveActiveGame(newState)
    savedGameRef.current = newState
    setSavedGame(newState)
    setGameState(newState)
  }, [])

  // Called by MenuScreen "Continue Game"
  const handleContinue = useCallback(() => {
    if (savedGameRef.current) setGameState(savedGameRef.current)
  }, [])

  // Called by MenuScreen "Quit & Start New Game"
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
  }, [])

  if (loading) return null

  if (gameState) {
    return (
      <GameScreen
        initialState={gameState}
        onReturnToMenu={handleReturnToMenu}
        onSave={handleSave}
        onGameEnd={handleGameEnd}
      />
    )
  }

  return (
    <MenuScreen
      initialSeats={initialSeats ?? undefined}
      initialSettings={initialSettings ?? undefined}
      activeGame={savedGame}
      onStart={handleStart}
      onContinue={handleContinue}
      onQuit={handleQuit}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
