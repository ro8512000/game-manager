import { useState, useEffect, useCallback, useRef } from 'react'
import type { Game, GamesData, ViewMode } from './types'
import { ALL_COLUMNS, DEFAULT_COLUMNS } from './types'
import type { Settings } from './electron.d'
import { localDateTime } from './utils'
import Sidebar from './components/Sidebar'
import GameGrid from './components/GameGrid'
import GameList from './components/GameList'
import GameDetail from './components/GameDetail'
import AddGameModal from './components/AddGameModal'
import ScanModal from './components/ScanModal'
import SettingsModal from './components/SettingsModal'
import GameContextMenu, { getDLsiteUrl } from './components/GameContextMenu'
import './App.css'

type InitialFile = { path: string; type: 'exe' | 'archive'; code: string | null }

export default function App(): React.JSX.Element {
  const [data, setData] = useState<GamesData>({ games: [] })
  const [settings, setSettings] = useState<Settings>({ gamesDir: null })
  const [selected, setSelected] = useState<Game | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('viewMode') as ViewMode) || 'grid'
  )

  const handleSetViewMode = (mode: ViewMode): void => {
    setViewMode(mode)
    localStorage.setItem('viewMode', mode)
  }

  const handleToggleColumn = (key: string): void => {
    setVisibleColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      const ordered = ALL_COLUMNS.filter((c) => next.includes(c.key)).map((c) => c.key)
      localStorage.setItem('listColumns', JSON.stringify(ordered))
      return ordered
    })
  }

  const launchGame = useCallback(async (game: Game): Promise<void> => {
    let exe = game.exe
    if (!exe && game.path) exe = await window.electronAPI.findExe(game.path)
    if (!exe) return
    window.electronAPI.launchGame({ exePath: exe, gameId: game.id })
    const updated: Game = { ...game, lastPlayedAt: localDateTime(), playCount: (game.playCount ?? 0) + 1, ...(exe && !game.exe ? { exe } : {}) }
    const newData = { games: dataRef.current.games.map((g) => (g.uuid === game.uuid ? updated : g)) }
    setData(newData)
    window.electronAPI.saveGames(newData)
    setSelected((prev) => (prev?.uuid === game.uuid ? updated : prev))
  }, [])

  const handleContextMenu = useCallback((game: Game, e: React.MouseEvent): void => {
    e.preventDefault()
    setCtxMenu({ game, x: e.clientX, y: e.clientY })
  }, [])

  const startPanelResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = detailWidthRef.current
    const onMove = (ev: MouseEvent): void => {
      const newW = Math.max(220, Math.min(600, startW + (startX - ev.clientX)))
      setDetailWidth(newW)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('detailWidth', String(detailWidthRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    if (deleteTarget.withFiles && deleteTarget.game.path) {
      await window.electronAPI.deleteFolder(deleteTarget.game.path)
    }
    await deleteGame(deleteTarget.game.uuid)
    setDeleteTarget(null)
  }

  const handleMoveColumn = (fromIdx: number, toIdx: number): void => {
    setVisibleColumns((prev) => {
      const next = [...prev]
      const [removed] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, removed)
      localStorage.setItem('listColumns', JSON.stringify(next))
      return next
    })
  }
  const [search, setSearch] = useState('')
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [filterRating, setFilterRating] = useState(0)
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  const handleTagToggle = (tag: string): void => {
    setFilterTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }
  const handleFilterTagSingle = (tag: string): void => setFilterTags([tag])
  const [addInitialFile, setAddInitialFile] = useState<InitialFile | null>(null)
  const [showScan, setShowScan] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ game: Game; x: number; y: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ game: Game; withFiles: boolean } | null>(null)
  const [detailWidth, setDetailWidth] = useState(() => parseInt(localStorage.getItem('detailWidth') || '300'))
  const detailWidthRef = useRef(detailWidth)
  useEffect(() => { detailWidthRef.current = detailWidth }, [detailWidth])
  const [loading, setLoading] = useState(true)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('listColumns') ?? 'null') || DEFAULT_COLUMNS }
    catch { return DEFAULT_COLUMNS }
  })

  const dataRef = useRef<GamesData>({ games: [] })
  useEffect(() => { dataRef.current = data }, [data])

  useEffect(() => {
    Promise.all([
      window.electronAPI.loadGames(),
      window.electronAPI.loadSettings()
    ]).then(([gamesData, settingsData]) => {
      setData(gamesData)
      setSettings(settingsData)
      setLoading(false)
    })
  }, [])

  // Listen for game session end → update playTime
  useEffect(() => {
    return window.electronAPI.onGameSessionEnd(({ gameId, elapsed }) => {
      const newGames = dataRef.current.games.map((g) =>
        g.id === gameId ? { ...g, playTime: (g.playTime ?? 0) + elapsed } : g
      )
      const newData = { games: newGames }
      setData(newData)
      window.electronAPI.saveGames(newData)
    })
  }, [])

  const save = useCallback(async (newData: GamesData) => {
    setData(newData)
    await window.electronAPI.saveGames(newData)
  }, [])

  const addGame = useCallback(
    async (game: Game) => {
      const newData = { games: [...data.games, game] }
      await save(newData)
    },
    [data, save]
  )

  const updateGame = useCallback(
    async (updated: Game) => {
      const newData = { games: data.games.map((g) => (g.uuid === updated.uuid ? updated : g)) }
      await save(newData)
      setSelected(updated)
    },
    [data, save]
  )

  const deleteGame = useCallback(
    async (uuid: string) => {
      const newData = { games: data.games.filter((g) => g.uuid !== uuid) }
      await save(newData)
      if (selected?.uuid === uuid) setSelected(null)
    },
    [data, save, selected]
  )

  const handleSaveSettings = useCallback(async (newSettings: Settings) => {
    setSettings(newSettings)
    await window.electronAPI.saveSettings(newSettings)
  }, [])

  // Open file dialog immediately on click; only show modal if file was selected
  const handleOpenAdd = useCallback(async () => {
    const result = await window.electronAPI.selectFile()
    if (!result) return
    setAddInitialFile(result)
  }, [])

  const handleCloseAdd = useCallback(() => {
    setAddInitialFile(null)
  }, [])

  const filtered = data.games.filter((g) => {
    if (favoritesOnly && !g.isFavorite) return false
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      g.title.toLowerCase().includes(q) ||
      g.id.toLowerCase().includes(q) ||
      g.circle.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q))
    const matchTag = filterTags.length === 0 || filterTags.every((t) => g.tags.includes(t))
    const matchRating = !filterRating || g.rating >= filterRating
    return matchSearch && matchTag && matchRating
  })

  const allTags = Array.from(new Set(data.games.flatMap((g) => g.tags))).sort()

  if (loading) {
    return <div className="loading">載入中...</div>
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-title">DLsite Manager</span>
        <div className="titlebar-actions">
          <button onClick={() => setShowScan(true)}>批量掃描</button>
          <button className="primary" onClick={handleOpenAdd}>
            + 新增遊戲
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="設定">
            ⚙
          </button>
        </div>
      </div>

      <div className="main-layout">
        <Sidebar
          tags={allTags}
          selectedTags={filterTags}
          filterRating={filterRating}
          favoritesOnly={favoritesOnly}
          onTagToggle={handleTagToggle}
          onClearTags={() => setFilterTags([])}
          onRatingChange={setFilterRating}
          onFavoritesChange={setFavoritesOnly}
          gameCount={filtered.length}
        />

        <div className="content">
          <div className="toolbar">
            <div className="search-wrapper">
              <input
                className="search"
                placeholder="搜尋遊戲、圓名、標籤..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch('')} title="清除搜尋">✕</button>
              )}
            </div>
            <div className="view-toggle">
              <button
                className={viewMode === 'grid' ? 'active' : ''}
                onClick={() => handleSetViewMode('grid')}
              >
                ⊞ 磁磚
              </button>
              <button
                className={viewMode === 'list' ? 'active' : ''}
                onClick={() => handleSetViewMode('list')}
              >
                ≡ 列表
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <GameGrid
              games={filtered}
              selected={selected}
              onSelect={setSelected}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <GameList
              games={filtered}
              selected={selected}
              onSelect={setSelected}
              visibleColumns={visibleColumns}
              onToggleColumn={handleToggleColumn}
              onMoveColumn={handleMoveColumn}
              onLaunch={launchGame}
              onContextMenu={handleContextMenu}
            />
          )}
        </div>

        {selected && (
          <div className="detail-panel-wrapper" style={{ width: detailWidth }}>
            <div className="detail-resize-bar" onMouseDown={startPanelResize} />
            <GameDetail
              game={selected}
              onUpdate={updateGame}
              onDelete={deleteGame}
              onClose={() => setSelected(null)}
              onFilterTag={handleFilterTagSingle}
              allTags={allTags}
            />
          </div>
        )}
      </div>

      {addInitialFile && (
        <AddGameModal
          initialFile={addInitialFile}
          onAdd={addGame}
          onClose={handleCloseAdd}
          existingIds={data.games.map((g) => g.id)}
          gamesDir={settings.gamesDir}
          onOpenSettings={() => { handleCloseAdd(); setShowSettings(true) }}
        />
      )}

      {showScan && (
        <ScanModal
          onAdd={addGame}
          onClose={() => setShowScan(false)}
          existingIds={data.games.map((g) => g.id)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <GameContextMenu
          game={ctxMenu.game}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onLaunch={() => launchGame(ctxMenu.game)}
          onOpenDLsite={() => window.electronAPI.openExternal(getDLsiteUrl(ctxMenu.game.id))}
          onOpenFolder={() => ctxMenu.game.path && window.electronAPI.openFolder(ctxMenu.game.path)}
          onSearchCircle={() => { setSearch(ctxMenu.game.circle); setFilterTags([]) }}
          onSearchCode={() => { setSearch(ctxMenu.game.id); setFilterTags([]) }}
          onRemove={() => setDeleteTarget({ game: ctxMenu.game, withFiles: false })}
          onRemoveWithFiles={() => setDeleteTarget({ game: ctxMenu.game, withFiles: true })}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>確認移除</h2>
              <button onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div>確定要移除《{deleteTarget.game.title || deleteTarget.game.id}》嗎？</div>
              {deleteTarget.withFiles && deleteTarget.game.path && (
                <div className="delete-warn">⚠ 將永久刪除：{deleteTarget.game.path}</div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn-delete" onClick={handleConfirmDelete}>確認移除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
