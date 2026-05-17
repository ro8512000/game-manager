import { useState, useEffect, useCallback, useRef } from 'react'
import type { Game, GamesData, ViewMode } from './types'
import { ALL_COLUMNS, DEFAULT_COLUMNS } from './types'
import type { Settings } from './electron.d'
import { localDateTime, getGameSortValue, findDuplicates, sortListGames } from './utils'
import Sidebar from './components/Sidebar'
import GameGrid from './components/GameGrid'
import GameList from './components/GameList'
import GameDetail from './components/GameDetail'
import AddGameModal from './components/AddGameModal'
import SettingsModal from './components/SettingsModal'
import GameContextMenu, { getDLsiteUrl } from './components/GameContextMenu'
import DuplicateModal from './components/DuplicateModal'
import ImportModal from './components/ImportModal'
import BatchFetchModal from './components/BatchFetchModal'
import ScanFolderModal from './components/ScanFolderModal'
import './App.css'

type InitialFile = { path: string; type: 'exe' | 'archive'; code: string | null }

export default function App(): React.JSX.Element {
  const [data, setData] = useState<GamesData>({ games: [] })
  const [settings, setSettings] = useState<Settings>({ gamesDir: null, leProcPath: null, fetchDescriptionOnFetch: false })
  const [selected, setSelected] = useState<Game | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [initColWidths, setInitColWidths] = useState<Record<string, number>>({})
  const [listSortKey, setListSortKey] = useState<string | null>(null)
  const [listSortDir, setListSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleSetViewMode = (mode: ViewMode): void => {
    setViewMode(mode)
    window.electronAPI.saveUiSettings({ viewMode: mode })
  }

  const handleToggleColumn = (key: string): void => {
    setVisibleColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      window.electronAPI.saveUiSettings({ listColumns: next })
      return next
    })
  }

  const launchGame = useCallback(async (game: Game): Promise<void> => {
    let exe = game.exe
    if (!exe && game.path) exe = await window.electronAPI.findExe(game.path)
    if (!exe) return
    window.electronAPI.launchGame({ exePath: exe, gameId: game.id, locale: game.launchLocale ?? undefined })
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
      window.electronAPI.saveUiSettings({ detailWidth: detailWidthRef.current })
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
      window.electronAPI.saveUiSettings({ listColumns: next })
      return next
    })
  }
  const [search, setSearch] = useState('')
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [tagFilterOr, setTagFilterOr] = useState(false)
  const [favoriteTags, setFavoriteTags] = useState<string[]>([])
  const [filterRating, setFilterRating] = useState(0)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [filterSources, setFilterSources] = useState<('dlsite' | 'steam' | 'getchu' | 'other')[]>(['dlsite', 'steam', 'getchu', 'other'])
  const [ratingCollapsed, setRatingCollapsed] = useState(false)
  const [sourceCollapsed, setSourceCollapsed] = useState(false)
  const [pageSize, setPageSize] = useState<number | null>(100)
  const [currentPage, setCurrentPage] = useState(1)

  const getGameSource = (id: string): 'dlsite' | 'steam' | 'getchu' | 'other' => {
    if (/^[RVB]J\d{6,8}$/i.test(id)) return 'dlsite'
    if (/^ST\d+$/i.test(id)) return 'steam'
    if (/^GC\d+$/i.test(id)) return 'getchu'
    return 'other'
  }

  const handleSourceToggle = (source: 'dlsite' | 'steam' | 'getchu' | 'other'): void => {
    setFilterSources((prev) => {
      const next = prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
      window.electronAPI.saveUiSettings({ filterSources: next })
      return next
    })
  }

  const handleRatingChange = (r: number): void => {
    setFilterRating(r)
    window.electronAPI.saveUiSettings({ filterRating: r })
  }

  const handleFavoritesChange = (v: boolean): void => {
    setFavoritesOnly(v)
    window.electronAPI.saveUiSettings({ favoritesOnly: v })
  }

  const handleRatingCollapsedChange = (v: boolean): void => {
    setRatingCollapsed(v)
    window.electronAPI.saveUiSettings({ ratingCollapsed: v })
  }

  const handleSourceCollapsedChange = (v: boolean): void => {
    setSourceCollapsed(v)
    window.electronAPI.saveUiSettings({ sourceCollapsed: v })
  }

  const handleTagToggle = (tag: string): void => {
    setFilterTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  const handleTagFilterOrChange = (v: boolean): void => {
    setTagFilterOr(v)
    window.electronAPI.saveUiSettings({ tagFilterOr: v })
  }

  const handleFavoriteTagToggle = (tag: string): void => {
    setFavoriteTags((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
      window.electronAPI.saveUiSettings({ favoriteTags: next })
      return next
    })
  }
  const handleFilterTagSingle = (tag: string): void => setFilterTags([tag])
  const [addInitialFile, setAddInitialFile] = useState<InitialFile | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showBatchFetch, setShowBatchFetch] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [gridSortKey, setGridSortKey] = useState<string | null>(null)
  const [gridSortDir, setGridSortDir] = useState<'asc' | 'desc'>('asc')
  const [listGroupBy, setListGroupBy] = useState<string>('')
  const [ctxMenu, setCtxMenu] = useState<{ game: Game; x: number; y: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ game: Game; withFiles: boolean } | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])
  const [detailWidth, setDetailWidth] = useState(300)
  const detailWidthRef = useRef(300)
  useEffect(() => { detailWidthRef.current = detailWidth }, [detailWidth])
  const [loading, setLoading] = useState(true)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS)

  const dataRef = useRef<GamesData>({ games: [] })
  useEffect(() => { dataRef.current = data }, [data])

  useEffect(() => {
    Promise.all([
      window.electronAPI.loadGames(),
      window.electronAPI.loadSettings(),
      window.electronAPI.loadUiSettings()
    ]).then(([gamesData, settingsData, ui]) => {
      setData(gamesData)
      setSettings(settingsData)
      if (ui.viewMode) setViewMode(ui.viewMode as ViewMode)
      if (ui.listColumns) setVisibleColumns(ui.listColumns as string[])
      if (ui.detailWidth) { setDetailWidth(ui.detailWidth as number); detailWidthRef.current = ui.detailWidth as number }
      if (ui.listColWidths) setInitColWidths(ui.listColWidths as Record<string, number>)
      if (ui.listSortKey) setListSortKey(ui.listSortKey as string)
      if (ui.listSortDir) setListSortDir(ui.listSortDir as 'asc' | 'desc')
      if (ui.filterRating !== undefined) setFilterRating(ui.filterRating as number)
      if (ui.favoritesOnly !== undefined) setFavoritesOnly(ui.favoritesOnly as boolean)
      if (ui.filterSources) setFilterSources(ui.filterSources as ('dlsite' | 'steam' | 'getchu' | 'other')[])
      if (ui.favoriteTags) setFavoriteTags(ui.favoriteTags as string[])
      if (ui.tagFilterOr !== undefined) setTagFilterOr(ui.tagFilterOr as boolean)
      if (ui.ratingCollapsed !== undefined) setRatingCollapsed(ui.ratingCollapsed as boolean)
      if (ui.sourceCollapsed !== undefined) setSourceCollapsed(ui.sourceCollapsed as boolean)
      if (ui.gridSortKey) setGridSortKey(ui.gridSortKey as string)
      if (ui.gridSortDir) setGridSortDir(ui.gridSortDir as 'asc' | 'desc')
      if (ui.listGroupBy) setListGroupBy(ui.listGroupBy as string)
      if ('pageSize' in ui) setPageSize(ui.pageSize as number | null)
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
      const newData = { games: dataRef.current.games.map((g) => (g.uuid === updated.uuid ? updated : g)) }
      await save(newData)
      setSelected(updated)
    },
    [save]
  )

  const deleteGame = useCallback(
    async (uuid: string) => {
      const newData = { games: data.games.filter((g) => g.uuid !== uuid) }
      await save(newData)
      if (selected?.uuid === uuid) setSelected(null)
    },
    [data, save, selected]
  )

  const handleSuggestDlsite = useCallback(async (game: Game): Promise<void> => {
    setCtxMenu(null)
    setToast({ msg: `搜尋中：${game.title}...`, ok: true })
    const result = await window.electronAPI.suggestFetchDlsite(game.title)
    if (!result.success || !result.data) {
      setToast({ msg: result.error || '沒有查詢結果', ok: false })
      return
    }
    const d = result.data
    await updateGame({
      ...game,
      id: result.id || game.id,
      title: (d.title as string) || game.title,
      circle: (d.circle as string) || game.circle,
      tags: (d.tags as string[])?.length > 0 ? (d.tags as string[]) : game.tags,
      cover: (d.localCover as string) || game.cover,
      listImage: (d.localListImage as string) || game.listImage,
      coverUrl: (d.coverUrl as string) || game.coverUrl,
      sampleImages: (d.sampleImages as string[]) || game.sampleImages,
      releaseDate: (d.releaseDate as string) || game.releaseDate,
      workType: (d.workType as string) || game.workType,
      dlsiteRating: (d.dlsiteRating as string) || game.dlsiteRating,
      infoUpdatedAt: localDateTime(),
    })
    setToast({ msg: `✓ 已更新為 ${result.id}: ${(d.title as string) || game.title}`, ok: true })
  }, [updateGame])

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
    if (!filterSources.includes(getGameSource(g.id))) return false
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      g.title.toLowerCase().includes(q) ||
      g.id.toLowerCase().includes(q) ||
      g.circle.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q))
    const matchTag = filterTags.length === 0 ||
      (tagFilterOr ? filterTags.some((t) => g.tags.includes(t)) : filterTags.every((t) => g.tags.includes(t)))
    const matchRating = !filterRating || g.rating >= filterRating
    return matchSearch && matchTag && matchRating
  })

  const handleListGroupByChange = (val: string): void => {
    setListGroupBy(val)
    window.electronAPI.saveUiSettings({ listGroupBy: val })
  }

  const handleListSortChange = (key: string | null, dir: 'asc' | 'desc' | null): void => {
    setListSortKey(key)
    setListSortDir(dir)
  }

  const handleGridSortChange = (key: string | null): void => {
    setGridSortKey(key)
    window.electronAPI.saveUiSettings({ gridSortKey: key })
  }

  const handleGridSortDirToggle = (): void => {
    const next = gridSortDir === 'asc' ? 'desc' : 'asc'
    setGridSortDir(next)
    window.electronAPI.saveUiSettings({ gridSortDir: next })
  }

  const sortedFiltered = gridSortKey && viewMode === 'grid'
    ? [...filtered].sort((a, b) => {
        const va = getGameSortValue(a, gridSortKey)
        const vb = getGameSortValue(b, gridSortKey)
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        const result = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'ja')
        return gridSortDir === 'asc' ? result : -result
      })
    : filtered

  const allTags = Array.from(new Set(data.games.flatMap((g) => g.tags))).sort()

  const sortedList = sortListGames(filtered, listSortKey, listSortDir, listGroupBy || null)

  // 換頁：篩選結果數量或 pageSize 改變時重置到第 1 頁
  const filteredLen = filtered.length
  useEffect(() => { setCurrentPage(1) }, [filteredLen, pageSize])

  const totalPages = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1
  const paginatedSortedFiltered = pageSize ? sortedFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sortedFiltered
  const paginatedFiltered = pageSize ? sortedList.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sortedList

  const handlePageSizeChange = (val: number | null): void => {
    setPageSize(val)
    setCurrentPage(1)
    window.electronAPI.saveUiSettings({ pageSize: val })
  }

  if (loading) {
    return <div className="loading">載入中...</div>
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-title">Game Manager</span>
        <div className="titlebar-actions">
          <button onClick={() => setShowScan(true)} title="掃描資料夾並批量加入遊戲">掃描資料夾</button>
          <button onClick={() => setShowImport(true)} title="從舊版 GameManager 匯入">匯入舊版</button>
          {data.games.length > 0 && (
            <button onClick={() => setShowDuplicates(true)} title="尋找重複遊戲">重複偵測</button>
          )}
          <button className="primary" onClick={handleOpenAdd}>+ 新增遊戲</button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="設定">⚙</button>
        </div>
      </div>

      <div className="main-layout">
        <Sidebar
          tags={allTags}
          selectedTags={filterTags}
          favoriteTags={favoriteTags}
          tagFilterOr={tagFilterOr}
          onFavoriteTagToggle={handleFavoriteTagToggle}
          filterRating={filterRating}
          filterSources={filterSources}
          favoritesOnly={favoritesOnly}
          ratingCollapsed={ratingCollapsed}
          sourceCollapsed={sourceCollapsed}
          onTagToggle={handleTagToggle}
          onClearTags={() => setFilterTags([])}
          onTagFilterOrChange={handleTagFilterOrChange}
          onRatingChange={handleRatingChange}
          onSourceToggle={handleSourceToggle}
          onFavoritesChange={handleFavoritesChange}
          onRatingCollapsedChange={handleRatingCollapsedChange}
          onSourceCollapsedChange={handleSourceCollapsedChange}
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
            {viewMode === 'list' && (
              <select
                className="grid-sort-select"
                value={listGroupBy}
                onChange={(e) => handleListGroupByChange(e.target.value)}
              >
                <option value="">分組：無</option>
                <option value="circle">社團</option>
                <option value="rating">個人評分</option>
                <option value="workType">作品形式</option>
                <option value="source">來源</option>
                <option value="releaseYear">發售年份</option>
              <option value="addedAtMonth">加入月份</option>
              <option value="releaseDateMonth">發售月份</option>
              <option value="lastPlayedAtMonth">上次遊玩月份</option>
              </select>
            )}
            {viewMode === 'grid' && (
              <div className="grid-sort-wrap">
                <select
                  className="grid-sort-select"
                  value={gridSortKey ?? ''}
                  onChange={(e) => handleGridSortChange(e.target.value || null)}
                >
                  <option value="">排序：預設</option>
                  {ALL_COLUMNS.map((col) => (
                    <option key={col.key} value={col.key}>{col.label}</option>
                  ))}
                </select>
                {gridSortKey && (
                  <button className="grid-sort-dir" onClick={handleGridSortDirToggle}>
                    {gridSortDir === 'asc' ? '▲' : '▼'}
                  </button>
                )}
              </div>
            )}
            {filtered.some((g) => /^[RVB]J\d{6,8}$/i.test(g.id)) && (
              <button
                onClick={() => setShowBatchFetch(true)}
                title="重新抓取目前列表內所有 DLsite 遊戲的資訊"
              >
                ↻ 批量更新 ({filtered.filter((g) => /^[RVB]J\d{6,8}$/i.test(g.id)).length})
              </button>
            )}
            <div className="view-toggle">
              <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => handleSetViewMode('grid')}>⊞ 磁磚</button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => handleSetViewMode('list')}>≡ 列表</button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <GameGrid
              games={paginatedSortedFiltered}
              selected={selected}
              onSelect={setSelected}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <GameList
              games={paginatedFiltered}
              selected={selected}
              onSelect={setSelected}
              visibleColumns={visibleColumns}
              onToggleColumn={handleToggleColumn}
              onMoveColumn={handleMoveColumn}
              onLaunch={launchGame}
              onContextMenu={handleContextMenu}
              initialColWidths={initColWidths}
              sortKey={listSortKey}
              sortDir={listSortDir}
              onSortChange={handleListSortChange}
              groupBy={listGroupBy || null}
              onGroupByChange={handleListGroupByChange}
              scrollKey={currentPage}
            />
          )}

          {/* 分頁欄 */}
          <div className="pagination-bar">
            <select
              className="page-size-select"
              value={pageSize ?? 0}
              onChange={(e) => { const v = parseInt(e.target.value); handlePageSizeChange(v === 0 ? null : v) }}
            >
              {[50, 100, 250, 500, 1000].map((n) => (
                <option key={n} value={n}>{n} 款/頁</option>
              ))}
              <option value={0}>全部</option>
            </select>
            {pageSize && totalPages > 1 && (
              <>
                <button className="page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>«</button>
                <button className="page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>‹</button>
                <span className="page-info">{currentPage} / {totalPages}</span>
                <button className="page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>›</button>
                <button className="page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>»</button>
              </>
            )}
            <span className="pagination-total">{filtered.length} 款遊戲</span>
          </div>
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
        <ScanFolderModal
          existingGames={data.games}
          gamesDir={settings.gamesDir}
          onAdd={async (games) => {
            const newData = { games: [...data.games, ...games] }
            await save(newData)
          }}
          onClose={() => setShowScan(false)}
        />
      )}

      {showBatchFetch && (
        <BatchFetchModal
          games={filtered.filter((g) => /^[RVB]J\d{6,8}$/i.test(g.id))}
          onUpdate={updateGame}
          onClose={() => setShowBatchFetch(false)}
        />
      )}

      {showImport && (
        <ImportModal
          existingIds={data.games.map((g) => g.id)}
          onImport={async (games) => {
            const newData = { games: [...data.games, ...games] }
            await save(newData)
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showDuplicates && (
        <DuplicateModal
          duplicates={findDuplicates(data.games)}
          onDelete={async (uuids) => {
            const newData = { games: data.games.filter((g) => !uuids.includes(g.uuid)) }
            await save(newData)
            if (selected && uuids.includes(selected.uuid)) setSelected(null)
          }}
          onClose={() => setShowDuplicates(false)}
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
          onSearchDLsiteWeb={() => {
            const kw = ctxMenu.game.title.trim().split(/\s+/).join('+')
            window.electronAPI.openExternal(`https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/${kw}/ana_flg/all/work_category%5B0%5D/doujin/work_category%5B1%5D/books/work_category%5B2%5D/pc/work_category%5B3%5D/app/order%5B0%5D/trend/options_and_or/and/per_page/30/page/1/from/fs.header`)
          }}
          onTryDLsiteFetch={() => handleSuggestDlsite(ctxMenu.game)}
          onSearchSteamWeb={() => window.electronAPI.openExternal(`https://store.steampowered.com/search?term=${encodeURIComponent(ctxMenu.game.title.trim())}`)}
          onSearchGetchuWeb={() => window.electronAPI.openGetchuSearch(ctxMenu.game.title.trim())}
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

      {/* Toast 通知 */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`} onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
