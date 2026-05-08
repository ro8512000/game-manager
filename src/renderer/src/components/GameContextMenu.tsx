import { useEffect, useRef } from 'react'
import type { Game } from '../types'

interface Props {
  game: Game
  x: number
  y: number
  onClose: () => void
  onLaunch: () => void
  onOpenDLsite: () => void
  onOpenFolder: () => void
  onSearchCircle: () => void
  onSearchCode: () => void
  onRemove: () => void
  onRemoveWithFiles: () => void
}

function getDLsiteUrl(id: string): string {
  if (id.startsWith('VJ')) return `https://www.dlsite.com/home/work/=/product_id/${id}.html`
  if (id.startsWith('BJ')) return `https://www.dlsite.com/boys-love/work/=/product_id/${id}.html`
  return `https://www.dlsite.com/maniax/work/=/product_id/${id}.html`
}

export { getDLsiteUrl }

export default function GameContextMenu({
  game, x, y, onClose,
  onLaunch, onOpenDLsite, onOpenFolder,
  onSearchCircle, onSearchCode, onRemove, onRemoveWithFiles
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const safeX = Math.min(x, window.innerWidth - 250)
  const safeY = Math.min(y, window.innerHeight - 280)

  useEffect(() => {
    const onMd = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMd)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onMd); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const act = (fn: () => void): void => { fn(); onClose() }
  const isRJ = /^[RVB]J\d{6,8}$/i.test(game.id)
  const isST = game.id.startsWith('ST')

  return (
    <div ref={ref} className="ctx-menu" style={{ top: safeY, left: safeX }}>
      {(game.exe || game.path) && (
        <button className="ctx-item" onClick={() => act(onLaunch)}>▶ 開啟遊戲</button>
      )}
      {isRJ && (
        <button className="ctx-item" onClick={() => act(onOpenDLsite)}>🌐 DLsite 頁面</button>
      )}
      {isST && (
        <button className="ctx-item" onClick={() => act(() => window.electronAPI.openExternal(`https://store.steampowered.com/app/${game.id.slice(2)}/`))}>
          🌐 Steam 頁面
        </button>
      )}
      {game.path && (
        <button className="ctx-item" onClick={() => act(onOpenFolder)}>📁 開啟遊戲資料夾</button>
      )}
      {(game.exe || game.path || isRJ || isST) && <div className="ctx-sep" />}
      {game.circle && (
        <button className="ctx-item" onClick={() => act(onSearchCircle)}>
          🔍 依照「{game.circle}」搜尋遊戲
        </button>
      )}
      <button className="ctx-item" onClick={() => act(onSearchCode)}>
        🔍 依照「{game.id}」搜尋遊戲
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item ctx-danger" onClick={() => act(onRemove)}>✕ 從列表移除</button>
      {game.path && (
        <button className="ctx-item ctx-danger" onClick={() => act(onRemoveWithFiles)}>
          🗑 移除並刪除檔案
        </button>
      )}
    </div>
  )
}
