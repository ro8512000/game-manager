import { useState, useEffect } from 'react'
import type { Game } from '../types'

interface Props {
  game: Game
  selected: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export default function GameCard({ game, selected, onClick, onContextMenu }: Props): React.JSX.Element {
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  useEffect(() => {
    if (game.cover) {
      window.electronAPI.getImageData(game.cover).then((data) => setImgSrc(data))
    } else if (game.coverUrl) {
      const url = game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl
      setImgSrc(url)
    } else {
      setImgSrc(null)
    }
  }, [game.cover, game.coverUrl])

  return (
    <div className={`game-card ${selected ? 'selected' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      <div className="card-cover">
        {imgSrc ? (
          <img src={imgSrc} alt={game.title} />
        ) : (
          <div className="no-cover">{game.id}</div>
        )}
        {game.rating > 0 && (
          <div className="card-rating">{'★'.repeat(game.rating)}</div>
        )}
        {game.isFavorite && <div className="card-fav">♥</div>}
      </div>
      <div className="card-info">
        <div className="card-title">{game.title || game.id}</div>
        <div className="card-circle">{game.circle}</div>
      </div>
    </div>
  )
}
