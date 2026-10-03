import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MenuScreen from './app/MenuScreen'
import GameScreen from './app/GameScreen'
import { createGame } from './game/state'
import type { GameState } from './game/state'

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null)

  const handleStart = (playerNames: string[], aiCount: number) => {
    setGameState(createGame(playerNames, aiCount))
  }

  const handleReturnToMenu = () => {
    setGameState(null)
  }

  if (gameState) {
    return (
      <GameScreen
        initialState={gameState}
        onReturnToMenu={handleReturnToMenu}
      />
    )
  }

  return <MenuScreen onStart={handleStart} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
