import { useState, useEffect, useRef } from 'react'
import type { Game } from '../types'
import { localDateTime, generateUUID } from '../utils'

interface ScanItem {
  folderPath: string
  folderName: string
  detectedCode: string | null
  detectedExe: string | null
}

type ItemType = 'dlsite' | 'steam' | 'other'

interface Props {
  existingGames: Game[]
  gamesDir: string | null
  onAdd: (games: Game[]) => Promise<void>
  onClose: () => void
}

function nextNFCode(existingIds: string[]): string {
  const nums = existingIds
    .filter((id) => /^NF\d+$/i.test(id))
    .map((id) => parseInt(id.slice(2), 10))
    .filter((n) => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `NF${String(max + 1).padStart(3, '0')}`
}

function getItemType(item: ScanItem): ItemType {
  if (item.detectedCode && /^[RVB]J\d{6,8}$/i.test(item.detectedCode)) return 'dlsite'
  if (item.detectedCode && /^ST\d+$/i.test(item.detectedCode)) return 'steam'
  return 'other'  // includes GC (Getchu) and no-code items
}

type Stage = 'idle' | 'scanning' | 'results' | 'adding' | 'done'

const TYPE_LABELS: Record<ItemType, string> = { dlsite: 'DLsite', steam: 'Steam', other: '其他' }
const ALL_TYPES: ItemType[] = ['dlsite', 'steam', 'other']

export default function ScanFolderModal({ existingGames, gamesDir, onAdd, onClose }: Props): React.JSX.Element {
  const [stage, setStage] = useState<Stage>('idle')
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [scanItems, setScanItems] = useState<ScanItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filterTypes, setFilterTypes] = useState<Set<ItemType>>(new Set(ALL_TYPES))
  const [moveToLib, setMoveToLib] = useState(false)
  const [addingItems, setAddingItems] = useState<ScanItem[]>([])
  const [addingIdx, setAddingIdx] = useState(0)
  const [stepMsg, setStepMsg] = useState('')
  const [stepPct, setStepPct] = useState(0)
  const [addedCount, setAddedCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    return window.electronAPI.onProgress(({ msg, pct }) => {
      setStepMsg(msg)
      setStepPct(pct)
    })
  }, [])

  const existingCodes = new Set(existingGames.map((g) => g.id.toUpperCase()))
  const existingPaths = new Set(existingGames.filter((g) => g.path).map((g) => g.path as string))

  const isInLibrary = (item: ScanItem): boolean => {
    if (item.detectedCode && existingCodes.has(item.detectedCode.toUpperCase())) return true
    if (existingPaths.has(item.folderPath)) return true
    return false
  }

  const visibleItems = scanItems.filter((i) => filterTypes.has(getItemType(i)))

  const handleSelectFolder = async (): Promise<void> => {
    const path = await window.electronAPI.selectFolder()
    if (path) setFolderPath(path)
  }

  const handleScan = async (): Promise<void> => {
    if (!folderPath) return
    setStage('scanning')
    const result = await window.electronAPI.scanFolder(folderPath)
    if (!result.success || !result.data) {
      setStage('idle')
      return
    }
    const items = result.data as ScanItem[]
    setScanItems(items)
    setChecked(new Set(items.filter((i) => !isInLibrary(i)).map((i) => i.folderPath)))
    setStage('results')
  }

  const toggleFilter = (type: ItemType): void => {
    setFilterTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const handleToggle = (fp: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(fp)) next.delete(fp)
      else next.add(fp)
      return next
    })
  }

  const handleAdd = async (): Promise<void> => {
    const toAdd = scanItems.filter((i) => checked.has(i.folderPath))
    setAddingItems(toAdd)
    setAddingIdx(0)
    setStage('adding')
    cancelledRef.current = false
    const newGames: Game[] = []
    let ok = 0
    let err = 0

    for (let i = 0; i < toAdd.length; i++) {
      if (cancelledRef.current) break
      setAddingIdx(i)
      const item = toAdd[i]

      try {
        let currentFolderPath = item.folderPath
        let detectedExe = item.detectedExe

        if (moveToLib && gamesDir) {
          setStepMsg(`${item.folderName} 正在移動...`)
          setStepPct(0)
          const moveResult = await window.electronAPI.moveFolderToLibrary({ srcFolder: item.folderPath, gamesDir })
          if (moveResult.success && moveResult.newFolderPath) {
            const newFolder = moveResult.newFolderPath
            if (detectedExe) {
              const suffix = detectedExe.slice(item.folderPath.length)
              detectedExe = newFolder + suffix
            }
            currentFolderPath = newFolder
          }
        }

        let gameId: string | null = item.detectedCode
        let title = item.folderName
        let circle = ''
        let tags: string[] = []
        let cover: string | null = null
        let listImage: string | null = null
        let coverUrl: string | null = null
        let sampleImages: string[] = []
        let releaseDate: string | null = null
        let workType: string | null = null
        let dlsiteRating: string | null = null

        if (gameId && /^[RVB]J\d{6,8}$/i.test(gameId)) {
          setStepMsg(`${gameId} 正在抓取 DLsite 資訊...`)
          setStepPct(0)
          const res = await window.electronAPI.fetchInfo(gameId)
          if (res.success && res.data) {
            const d = res.data
            title = (d.title as string) || title
            circle = (d.circle as string) || ''
            tags = (d.tags as string[]) || []
            cover = (d.localCover as string) || null
            listImage = (d.localListImage as string) || null
            coverUrl = (d.coverUrl as string) || null
            sampleImages = (d.sampleImages as string[]) || []
            releaseDate = (d.releaseDate as string) || null
            workType = (d.workType as string) || null
            dlsiteRating = (d.dlsiteRating as string) || null
          }
        } else if (gameId && /^ST\d+$/i.test(gameId)) {
          const appId = gameId.slice(2)
          setStepMsg(`${gameId} 正在抓取 Steam 資訊...`)
          setStepPct(0)
          const res = await window.electronAPI.fetchSteamInfo(appId)
          if (res.success && res.data) {
            const d = res.data
            title = (d.title as string) || title
            circle = (d.circle as string) || ''
            tags = (d.tags as string[]) || []
            cover = (d.localCover as string) || null
            coverUrl = (d.coverUrl as string) || null
            sampleImages = (d.sampleImages as string[]) || []
            releaseDate = (d.releaseDate as string) || null
          }
        } else if (gameId && /^GC\d+$/i.test(gameId)) {
          const gcId = gameId.slice(2)
          setStepMsg(`${gameId} 正在抓取 Getchu 資訊...`)
          setStepPct(0)
          const res = await window.electronAPI.fetchGetchuInfo(gcId)
          if (res.success && res.data) {
            const d = res.data
            title = (d.title as string) || title
            circle = (d.circle as string) || ''
            tags = (d.tags as string[]) || []
            cover = (d.localCover as string) || null
            coverUrl = (d.coverUrl as string) || null
            sampleImages = (d.sampleImages as string[]) || []
            releaseDate = (d.releaseDate as string) || null
          }
        } else {
          setStepMsg(`${item.folderName} 加入中...`)
          setStepPct(50)
        }

        if (!gameId) {
          const allIds = [...existingGames.map((g) => g.id), ...newGames.map((g) => g.id)]
          gameId = nextNFCode(allIds)
        }

        const folderSize = await window.electronAPI.getFolderSize(currentFolderPath)

        const game: Game = {
          uuid: generateUUID(),
          id: gameId,
          title,
          circle,
          tags,
          cover,
          coverUrl,
          listImage,
          sampleImages,
          path: currentFolderPath,
          exe: detectedExe,
          rating: 0,
          note: '',
          addedAt: localDateTime(),
          language: 'ja',
          releaseDate,
          workType,
          dlsiteRating,
          lastPlayedAt: null,
          infoUpdatedAt: (item.detectedCode && cover) ? localDateTime() : null,
          playCount: 0,
          playTime: 0,
          isFavorite: false,
          folderSize,
          launchLocale: null
        }
        newGames.push(game)
        ok++
      } catch {
        err++
      }
    }

    await onAdd(newGames)
    setAddedCount(ok)
    setErrorCount(err)
    setStage('done')
  }

  // Counts per type (all items, not just visible)
  const typeCounts = scanItems.reduce<Record<ItemType, number>>(
    (acc, i) => { acc[getItemType(i)]++; return acc },
    { dlsite: 0, steam: 0, other: 0 }
  )
  const notInLibraryCount = scanItems.filter((i) => !isInLibrary(i)).length
  const checkedCount = checked.size

  return (
    <div
      className="modal-overlay"
      onClick={stage === 'idle' || stage === 'done' ? onClose : undefined}
    >
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>掃描資料夾</h2>
          {stage !== 'adding' && <button onClick={onClose}>✕</button>}
        </div>

        <div className="modal-body" style={{ gap: 12 }}>
          {/* Folder picker */}
          {(stage === 'idle' || stage === 'results') && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                flex: 1, background: 'var(--bg2)', borderRadius: 4,
                padding: '6px 10px', fontSize: 13,
                color: folderPath ? 'var(--text)' : 'var(--text2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {folderPath ?? '尚未選擇資料夾'}
              </div>
              <button onClick={handleSelectFolder}>選擇資料夾</button>
            </div>
          )}

          {stage === 'scanning' && (
            <div style={{ color: 'var(--text2)', fontSize: 13, padding: '8px 0' }}>掃描中...</div>
          )}

          {stage === 'results' && (
            <>
              {/* Summary */}
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                找到 <strong style={{ color: 'var(--text)' }}>{scanItems.length}</strong> 個資料夾，
                其中 <strong style={{ color: 'var(--accent)' }}>{notInLibraryCount}</strong> 個尚未在庫中
              </div>

              {scanItems.length === 0 ? (
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>此資料夾內沒有子資料夾</div>
              ) : (
                <>
                  {/* Type filter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>顯示：</span>
                    {ALL_TYPES.map((type) => (
                      <button
                        key={type}
                        style={{
                          fontSize: 12, padding: '2px 10px',
                          opacity: filterTypes.has(type) ? 1 : 0.35,
                          background: filterTypes.has(type) ? 'var(--accent)' : 'var(--bg3)',
                          color: filterTypes.has(type) ? '#fff' : 'var(--text2)',
                          border: 'none', borderRadius: 3, cursor: 'pointer'
                        }}
                        onClick={() => toggleFilter(type)}
                      >
                        {TYPE_LABELS[type]}
                        {typeCounts[type] > 0 && (
                          <span style={{ marginLeft: 4, opacity: 0.8 }}>({typeCounts[type]})</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Move option */}
                  {gamesDir ? (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={moveToLib}
                        onChange={(e) => setMoveToLib(e.target.checked)}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
                      <span>
                        移動到遊戲資料夾
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{gamesDir}</span>
                      </span>
                    </label>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                      ⚠ 未設定遊戲資料夾，將直接記錄原始路徑（可在設定中設定）
                    </div>
                  )}

                  {/* Select all shortcuts — operate on visible items only */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          visibleItems.filter((i) => !isInLibrary(i)).forEach((i) => next.add(i.folderPath))
                          return next
                        })
                      }
                    >
                      全選未入庫
                    </button>
                    <button
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          visibleItems.forEach((i) => next.add(i.folderPath))
                          return next
                        })
                      }
                    >
                      全選
                    </button>
                    <button
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          visibleItems.forEach((i) => next.delete(i.folderPath))
                          return next
                        })
                      }
                    >
                      全不選
                    </button>
                    {visibleItems.length < scanItems.length && (
                      <span style={{ fontSize: 11, color: 'var(--text2)', alignSelf: 'center', marginLeft: 4 }}>
                        顯示 {visibleItems.length} / {scanItems.length}
                      </span>
                    )}
                  </div>

                  {/* Item list */}
                  <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {visibleItems.length === 0 ? (
                      <div style={{ color: 'var(--text2)', fontSize: 13, padding: '8px 0' }}>
                        此類型無符合項目
                      </div>
                    ) : (
                      visibleItems.map((item) => {
                        const inLib = isInLibrary(item)
                        const type = getItemType(item)
                        return (
                          <label
                            key={item.folderPath}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 8px', background: 'var(--bg2)', borderRadius: 4,
                              cursor: 'pointer', opacity: inLib ? 0.65 : 1
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked.has(item.folderPath)}
                              onChange={() => handleToggle(item.folderPath)}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.folderName}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 6, marginTop: 2 }}>
                                <span style={{
                                  color: type === 'dlsite' ? 'var(--accent)' : type === 'steam' ? '#4a9eff' : 'var(--text2)'
                                }}>
                                  {item.detectedCode ?? '無代碼'}
                                </span>
                                <span>{item.detectedExe ? '有 exe' : '無 exe'}</span>
                                {inLib && <span style={{ color: '#f59e0b' }}>已在庫中</span>}
                              </div>
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {stage === 'adding' && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                整體進度：{addingIdx + 1} / {addingItems.length}
                <span style={{ marginLeft: 8, color: 'var(--accent)' }}>
                  {addingItems[addingIdx]?.folderName}
                </span>
              </div>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${Math.round((addingIdx / Math.max(addingItems.length, 1)) * 100)}%`,
                    background: 'var(--accent)'
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{stepMsg}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${stepPct}%` }} />
              </div>
            </>
          )}

          {stage === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="import-stat-row">
                <span>成功加入</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{addedCount} 款</span>
              </div>
              {errorCount > 0 && (
                <div className="import-stat-row">
                  <span>失敗</span>
                  <span style={{ color: 'var(--text2)' }}>{errorCount} 款</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {stage === 'idle' && (
            <>
              <button onClick={onClose}>取消</button>
              <button className="primary" onClick={handleScan} disabled={!folderPath}>
                開始掃描
              </button>
            </>
          )}
          {stage === 'results' && (
            <>
              <button onClick={() => { setScanItems([]); setChecked(new Set()); setStage('idle') }}>
                重新選擇
              </button>
              <button className="primary" onClick={handleAdd} disabled={checkedCount === 0}>
                加入選取 ({checkedCount})
              </button>
            </>
          )}
          {stage === 'adding' && (
            <button onClick={() => { cancelledRef.current = true }}>停止</button>
          )}
          {stage === 'done' && (
            <button className="primary" onClick={onClose}>完成</button>
          )}
        </div>
      </div>
    </div>
  )
}
