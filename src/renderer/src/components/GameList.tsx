import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { Game } from '../types'
import { ALL_COLUMNS } from '../types'
import { formatPlayTime, formatFileSize, getGroupValue } from '../utils'

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
  initialColWidths?: Record<string, number>
  initialSortKey?: string | null
  initialSortDir?: 'asc' | 'desc' | null
  groupBy?: string | null
  onGroupByChange?: (key: string) => void
}

function ListThumb({ game }: { game: Game }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const isSteam = game.id.startsWith('ST')

  useEffect(() => {
    setSrc(null)
    let cancelled = false

    const load = async (): Promise<void> => {
      if (isSteam) {
        if (game.cover) {
          const data = await window.electronAPI.getImageData(game.cover)
          if (cancelled) return
          if (data) { setSrc(data); return }
        }
        if (game.coverUrl && !cancelled)
          setSrc(game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl)
        return
      }
      // DLsite/other/Getchu: listImage → cover → remote
      if (game.listImage) {
        const data = await window.electronAPI.getImageData(game.listImage)
        if (cancelled) return
        if (data) { setSrc(data); return }
      }
      if (game.cover) {
        const data = await window.electronAPI.getImageData(game.cover)
        if (cancelled) return
        if (data) { setSrc(data); return }
      }
      if (game.coverUrl && !cancelled) {
        const url = game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl
        setSrc(url.replace('_img_main', '_img_sam'))
      }
    }

    load()
    return () => { cancelled = true }
  }, [game.listImage, game.cover, game.coverUrl, game.id, isSteam])

  if (!src) return <div className="list-thumb-empty" />
  return <img src={src} alt="" className="list-thumb-img" onError={() => setSrc(null)} />
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
    case 'folderSize':   return game.folderSize ?? null
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
    case 'folderSize':   return game.folderSize != null ? formatFileSize(game.folderSize) : '-'
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
  onContextMenu,
  initialColWidths = {},
  initialSortKey = null,
  initialSortDir = null,
  groupBy = null,
  onGroupByChange
}: Props): React.JSX.Element {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [hoverPreview, setHoverPreview] = useState<{
    game: Game; x: number; y: number
    sources: (string | null)[]
    currentIdx: number
  } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOverPreviewRef = useRef(false)
  const hoverPreviewRef = useRef(hoverPreview)
  useEffect(() => { hoverPreviewRef.current = hoverPreview }, [hoverPreview])

  const previewRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const handler = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const current = hoverPreviewRef.current
      if (!current) return
      const total = current.sources.length
      if (total <= 1) return
      const delta = e.deltaY > 0 ? 1 : -1
      setHoverPreview(prev =>
        prev ? { ...prev, currentIdx: (prev.currentIdx + delta + total) % total } : null
      )
    }
    node.addEventListener('wheel', handler, { passive: false })
  }, [])

  const [colWidths, setColWidths] = useState<Record<string, number>>(initialColWidths)
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)
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

  const THUMB_W = 32
  const getWidth = (key: string): number => colWidths[key] ?? defaultPx(key)
  const gridTemplate = `${THUMB_W}px ` + visibleColumns.map((k) => `${getWidth(k)}px`).join(' ')
  const totalWidth = THUMB_W + visibleColumns.reduce((sum, k) => sum + getWidth(k), 0)

  const handleRowEnter = (game: Game, e: React.MouseEvent): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const { clientX: x, clientY: y } = e
    hoverTimer.current = setTimeout(async () => {
      const localPaths = [game.cover, ...(game.sampleImages ?? [])].filter((p): p is string => !!p)
      const remoteFallback = game.coverUrl
        ? (game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl)
        : null

      let firstSrc: string | null = null
      if (localPaths[0]) firstSrc = await window.electronAPI.getImageData(localPaths[0])
      if (!firstSrc && remoteFallback) firstSrc = remoteFallback
      if (!firstSrc) return

      const totalCount = localPaths.length || (remoteFallback ? 1 : 0)
      const sources: (string | null)[] = new Array(totalCount).fill(null)
      sources[0] = firstSrc
      setHoverPreview({ game, x, y, sources, currentIdx: 0 })

      for (let i = 1; i < localPaths.length; i++) {
        const idx = i
        window.electronAPI.getImageData(localPaths[idx]).then(data => {
          if (!data) return
          setHoverPreview(prev => {
            if (!prev || prev.game.uuid !== game.uuid) return prev
            const next = [...prev.sources]; next[idx] = data
            return { ...prev, sources: next }
          })
        })
      }
    }, 300)
  }

  const scheduleHide = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!isOverPreviewRef.current) setHoverPreview(null)
    }, 150)
  }

  const cancelHide = (): void => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }

  const handleRowLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    scheduleHide()
  }

  const handleRowWheel = (game: Game, e: React.WheelEvent): void => {
    if (!hoverPreview || hoverPreview.game.uuid !== game.uuid) return
    const total = hoverPreview.sources.length
    if (total <= 1) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? 1 : -1
    setHoverPreview(prev =>
      prev ? { ...prev, currentIdx: (prev.currentIdx + delta + total) % total } : null
    )
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
      setColWidths((prev) => { window.electronAPI.saveUiSettings({ listColWidths: prev }); return prev })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const DATE_GROUP_MAP: Record<string, string> = {
    addedAt: 'addedAtMonth',
    releaseDate: 'releaseDateMonth',
    lastPlayedAt: 'lastPlayedAtMonth'
  }

  const handleSortClick = (key: string): void => {
    if (sortKey !== key) {
      setSortKey(key); setSortDir('asc')
      window.electronAPI.saveUiSettings({ listSortKey: key, listSortDir: 'asc' })
      if (key in DATE_GROUP_MAP) onGroupByChange?.(DATE_GROUP_MAP[key])
      else onGroupByChange?.('')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
      window.electronAPI.saveUiSettings({ listSortDir: 'desc' })
    } else {
      setSortKey(null); setSortDir(null)
      window.electronAPI.saveUiSettings({ listSortKey: null, listSortDir: null })
      onGroupByChange?.('')
    }
  }

  const UNKNOWN_GROUPS = new Set(['未知', '未知日期', '未知年份', '未知月份', '從未遊玩'])
  const compareGroups = (ga: string, gb: string, dir: 'asc' | 'desc'): number => {
    const aUnknown = UNKNOWN_GROUPS.has(ga)
    const bUnknown = UNKNOWN_GROUPS.has(gb)
    if (aUnknown && bUnknown) return 0
    if (aUnknown) return 1
    if (bUnknown) return -1
    const cmp = ga.localeCompare(gb, 'ja')
    return dir === 'desc' ? -cmp : cmp
  }

  const sortedGames = useMemo(() => {
    let list = [...games]
    const dir = sortDir ?? 'asc'
    if (groupBy) {
      list.sort((a, b) => compareGroups(getGroupValue(a, groupBy), getGroupValue(b, groupBy), dir))
    }
    if (sortKey && sortDir) {
      list.sort((a, b) => {
        if (groupBy) {
          const ga = getGroupValue(a, groupBy)
          const gb = getGroupValue(b, groupBy)
          const groupCmp = compareGroups(ga, gb, dir)
          if (groupCmp !== 0) return groupCmp
        }
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
    }
    return list
  }, [games, sortKey, sortDir, groupBy])

  // 鍵盤上下箭頭切換選取遊戲
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (!selected) return
      const idx = sortedGames.findIndex((g) => g.uuid === selected.uuid)
      if (idx === -1) return
      e.preventDefault()
      const nextIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1
      if (nextIdx >= 0 && nextIdx < sortedGames.length) onSelect(sortedGames[nextIdx])
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, sortedGames, onSelect])

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
          <div className="list-header-cell list-header-thumb" />
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
                title="點擊排序，拖曳調整順序"
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
        {sortedGames.map((game, idx) => {
          const groupLabel = groupBy ? getGroupValue(game, groupBy) : null
          const prevGroupLabel = groupBy && idx > 0 ? getGroupValue(sortedGames[idx - 1], groupBy) : null
          const showHeader = groupBy && groupLabel !== prevGroupLabel
          const groupCount = groupBy ? sortedGames.filter((g) => getGroupValue(g, groupBy) === groupLabel).length : 0
          return (
            <React.Fragment key={game.uuid}>
              {showHeader && (
                <div className="list-group-header" style={{ gridColumn: `1 / ${visibleColumns.length + 1}` }}>
                  {groupLabel} <span className="list-group-count">({groupCount})</span>
                </div>
              )}
              <div
                className={`list-row ${selected?.uuid === game.uuid ? 'selected' : ''}`}
                style={{ gridTemplateColumns: gridTemplate }}
                onClick={() => onSelect(game)}
                onDoubleClick={() => onLaunch(game)}
                onContextMenu={(e) => onContextMenu(game, e)}
                onMouseEnter={(e) => handleRowEnter(game, e)}
                onMouseLeave={handleRowLeave}
                onWheel={(e) => handleRowWheel(game, e)}
              >
                <span className="col-cell col-thumb">
                  <ListThumb game={game} />
                </span>
                {visibleColumns.map((key) => (
                  <span key={key} className={`col-cell col-${key}`}>
                    {key === 'title' && game.isFavorite ? `♥ ${renderCell(game, key)}` : renderCell(game, key)}
                  </span>
                ))}
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* ── Image hover preview ── */}
      {hoverPreview && hoverPreview.sources.some(Boolean) && (
        <div
          ref={previewRef}
          className="list-hover-preview"
          style={{
            top: Math.min(hoverPreview.y - 10, window.innerHeight - 230),
            left: hoverPreview.x > window.innerWidth * 0.6 ? hoverPreview.x - 340 : hoverPreview.x + 18,
            pointerEvents: 'auto'
          }}
          onMouseEnter={() => { isOverPreviewRef.current = true; cancelHide() }}
          onMouseLeave={() => { isOverPreviewRef.current = false; scheduleHide() }}
        >
          {hoverPreview.sources[hoverPreview.currentIdx]
            ? <img src={hoverPreview.sources[hoverPreview.currentIdx]!} alt="" />
            : <div className="preview-loading">載入中...</div>
          }
          {hoverPreview.sources.length > 1 && (
            <div className="preview-counter">
              {hoverPreview.currentIdx + 1} / {hoverPreview.sources.length}
            </div>
          )}
        </div>
      )}

      {/* ── Column visibility menu ── */}
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
