import type { Game } from '../types'
import GameCard from './GameCard'

interface Props {
  games: Game[]
  selected: Game | null
  onSelect: (game: Game) => void
  onContextMenu: (game: Game, e: React.MouseEvent) => void
}

export default function GameGrid({ games, selected, onSelect, onContextMenu }: Props): React.JSX.Element {
  if (games.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🎮</div>
        <div>尚無遊戲，點擊右上角「新增遊戲」開始</div>
      </div>
    )
  }

  return (
    <div className="game-grid">
      {games.map((game) => (
        <GameCard
          key={game.uuid}
          game={game}
          selected={selected?.uuid === game.uuid}
          onClick={() => onSelect(game)}
          onContextMenu={(e) => onContextMenu(game, e)}
        />
      ))}
    </div>
  )
}
