import { useState, useEffect, memo } from 'react'
import type { Game } from '../types'

interface Props {
  game: Game
  selected: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export default memo(function GameCard({ game, selected, onClick, onContextMenu }: Props): React.JSX.Element {
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (game.cover) {
      window.electronAPI.getImageData(game.cover).then((data) => {
        if (cancelled) return
        setImgSrc(data)
      })
    } else if (game.coverUrl) {
      setImgSrc(game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl)
    } else {
      setImgSrc(null)
    }
    return () => { cancelled = true }
  }, [game.cover, game.coverUrl])

  return (
    <div className={`game-card ${selected ? 'selected' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      <div className="card-cover">
        {imgSrc ? (
          <img src={imgSrc} alt={game.title} loading="lazy" />
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
})
