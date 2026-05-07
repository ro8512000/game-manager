import { useState, useEffect, useRef, useMemo } from 'react'
import type { Game } from '../types'
import { ALL_COLUMNS } from '../types'
import { formatPlayTime } from '../utils'

type SortDir = 'asc' | 'desc' | null

interface Props {
  games: Game[]
  selected: Game | null
  onSelect: (game: Game) => void
  visibleColumns: string[]
  onToggleColumn: (key: string) => void
  onMoveColumn: (fromIdx: number, toIdx: number) => void
  onLaunch: (game: Game) => void
  onContextMenu: (game: Game, e: React.MouseEvent) => void
}

function defaultPx(key: string): number {
  const col = ALL_COLUMNS.find((c) => c.key === key)
  if (!col) return 100
  if (col.width === '1fr') return 250
  return parseInt(col.width) || 100
}

function getCellValue(game: Game, key: string): string | number | null {
  switch (key) {
    case 'id':           return game.id
    case 'title':        return game.title || game.id
    case 'circle':       return game.circle
    case 'workType':     return game.workType ?? null
    case 'tags':         return game.tags.join(', ')
    case 'dlsiteRating': return game.dlsiteRating ? parseFloat(game.dlsiteRating) : null
    case 'rating':       return game.rating
    case 'releaseDate':  return game.releaseDate ?? null
    case 'addedAt':      return game.addedAt
    case 'lastPlayedAt': return game.lastPlayedAt ?? null
    case 'playCount':    return game.playCount ?? 0
    case 'playTime':     return game.playTime ?? 0
    default: return null
  }
}

function renderCell(game: Game, key: string): string {
  switch (key) {
    case 'id':           return game.id
    case 'title':        return game.title || game.id
    case 'circle':       return game.circle
    case 'workType':     return game.workType || '-'
    case 'tags':         return game.tags.slice(0, 3).join(', ') || '-'
    case 'dlsiteRating': return game.dlsiteRating ? `★ ${game.dlsiteRating}` : '-'
    case 'rating':       return game.rating ? '★'.repeat(game.rating) + '☆'.repeat(5 - game.rating) : '☆☆☆☆☆'
    case 'releaseDate':  return game.releaseDate || '-'
    case 'addedAt':      return game.addedAt
    case 'lastPlayedAt': return game.lastPlayedAt || '從未遊玩'
    case 'playCount':    return `${game.playCount ?? 0} 次`
    case 'playTime':     return formatPlayTime(game.playTime ?? 0)
    default: return ''
  }
}

export default function GameList({
  games,
  selected,
  onSelect,
  visibleColumns,
  onToggleColumn,
  onMoveColumn,
  onLaunch,
  onContextMenu
}: Props): React.JSX.Element {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [hoverPreview, setHoverPreview] = useState<{ game: Game; x: number; y: number; imgSrc: string | null } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('listColWidths') ?? 'null') || {} }
    catch { return {} }
  })
  const [sortKey, setSortKey] = useState<string | null>(() => localStorage.getItem('listSortKey') || null)
  const [sortDir, setSortDir] = useState<SortDir>(() => (localStorage.getItem('listSortDir') as SortDir) || null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuPos) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuPos(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuPos])

  const getWidth = (key: string): number => colWidths[key] ?? defaultPx(key)
  const gridTemplate = visibleColumns.map((k) => `${getWidth(k)}px`).join(' ')
  const totalWidth = visibleColumns.reduce((sum, k) => sum + getWidth(k), 0)

  const handleRowEnter = (game: Game, e: React.MouseEvent): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const { clientX: x, clientY: y } = e
    hoverTimer.current = setTimeout(async () => {
      let imgSrc: string | null = null
      // Prefer local file (returns base64, always works offline)
      if (game.cover) {
        imgSrc = await window.electronAPI.getImageData(game.cover)
      }
      if (!imgSrc && game.sampleImages?.[0]) {
        imgSrc = await window.electronAPI.getImageData(game.sampleImages[0])
      }
      // Fallback to remote URL
      if (!imgSrc && game.coverUrl) {
        imgSrc = game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl
      }
      if (imgSrc) setHoverPreview({ game, x, y, imgSrc })
    }, 300)
  }

  const handleRowLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverPreview(null)
  }

  const startResize = (key: string, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = getWidth(key)
    const onMove = (ev: MouseEvent): void => {
      setColWidths((prev) => ({ ...prev, [key]: Math.max(50, startW + ev.clientX - startX) }))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setColWidths((prev) => { localStorage.setItem('listColWidths', JSON.stringify(prev)); return prev })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleSortClick = (key: string): void => {
    if (sortKey !== key) {
      setSortKey(key); setSortDir('asc')
      localStorage.setItem('listSortKey', key); localStorage.setItem('listSortDir', 'asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc'); localStorage.setItem('listSortDir', 'desc')
    } else {
      setSortKey(null); setSortDir(null)
      localStorage.removeItem('listSortKey'); localStorage.removeItem('listSortDir')
    }
  }

  const sortedGames = useMemo(() => {
    if (!sortKey || !sortDir) return games
    return [...games].sort((a, b) => {
      const va = getCellValue(a, sortKey)
      const vb = getCellValue(b, sortKey)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      let result: number
      if (typeof va === 'number' && typeof vb === 'number') result = va - vb
      else result = String(va).localeCompare(String(vb), 'ja')
      return sortDir === 'asc' ? result : -result
    })
  }, [games, sortKey, sortDir])

  if (games.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🎮</div>
        <div>尚無遊戲，點擊右上角「新增遊戲」開始</div>
      </div>
    )
  }

  return (
    <div className="game-list" onClick={() => setMenuPos(null)}>
      <div className="game-list-inner" style={{ minWidth: totalWidth }}>

        {/* ── Header ── */}
        <div
          className="list-header"
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
        >
          {visibleColumns.map((key, i) => {
            const isSort = sortKey === key
            const label = ALL_COLUMNS.find((c) => c.key === key)?.label || key
            return (
              <div
                key={key}
                className={`list-header-cell ${dragOverIdx === i ? 'drag-over' : ''}`}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i) }}
                onDragOver={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) setDragOverIdx(i) }}
                onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) onMoveColumn(dragIdx, i); setDragIdx(null); setDragOverIdx(null) }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                onClick={() => handleSortClick(key)}
                title={`點擊排序，拖曳調整順序`}
              >
                <span className="header-label">{label}</span>
                <span className={`sort-icon ${isSort ? 'active' : ''}`}>
                  {isSort ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => startResize(key, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )
          })}
        </div>

        {/* ── Rows ── */}
        {sortedGames.map((game) => (
          <div
            key={game.uuid}
            className={`list-row ${selected?.uuid === game.uuid ? 'selected' : ''}`}
            style={{ gridTemplateColumns: gridTemplate }}
            onClick={() => onSelect(game)}
            onDoubleClick={() => onLaunch(game)}
            onContextMenu={(e) => onContextMenu(game, e)}
            onMouseEnter={(e) => handleRowEnter(game, e)}
            onMouseLeave={handleRowLeave}
          >
            {visibleColumns.map((key) => (
              <span key={key} className={`col-cell col-${key}`}>
                {key === 'title' && game.isFavorite ? `♥ ${renderCell(game, key)}` : renderCell(game, key)}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Image hover preview */}
      {hoverPreview?.imgSrc && (
        <div
          className="list-hover-preview"
          style={{
            top: Math.min(hoverPreview.y - 10, window.innerHeight - 230),
            left: hoverPreview.x > window.innerWidth * 0.6 ? hoverPreview.x - 340 : hoverPreview.x + 18
          }}
        >
          <img src={hoverPreview.imgSrc} alt="" />
        </div>
      )}

      {/* Column visibility menu */}
      {menuPos && (
        <div
          ref={menuRef}
          className="col-menu"
          style={{ top: menuPos.y, left: menuPos.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="col-menu-title">顯示欄位</div>
          {ALL_COLUMNS.map((col) => (
            <label key={col.key} className="col-menu-item">
              <input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => onToggleColumn(col.key)} />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
