import { useState } from 'react'
import { localDateTime, generateUUID } from '../utils'
import type { Game } from '../types'

interface ScanResult {
  code: string
  name: string
  path: string
  isDir: boolean
  selected: boolean
  fetching: boolean
  info: Record<string, unknown> | null
}

interface Props {
  onAdd: (game: Game) => Promise<void>
  onClose: () => void
  existingIds: string[]
}

export default function ScanModal({ onAdd, onClose, existingIds }: Props): React.JSX.Element {
  const [results, setResults] = useState<ScanResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [folderPath, setFolderPath] = useState('')

  const handleSelectFolder = async (): Promise<void> => {
    const path = await window.electronAPI.selectFolder()
    if (!path) return
    setFolderPath(path)
    setScanning(true)
    setResults([])

    const result = await window.electronAPI.scanFolder(path)
    setScanning(false)

    if (result.success && result.data) {
      const items: ScanResult[] = (result.data as { code: string; name: string; path: string; isDir: boolean }[])
        .filter((item) => !existingIds.includes(item.code))
        .map((item) => ({
          code: item.code,
          name: item.name,
          path: item.path,
          isDir: item.isDir,
          selected: true,
          fetching: false,
          info: null
        }))
      setResults(items)

      items.forEach(async (item, idx) => {
        setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, fetching: true } : r)))
        const res = await window.electronAPI.fetchInfo(item.code)
        setResults((prev) =>
          prev.map((r, i) =>
            i === idx ? { ...r, fetching: false, info: res.success ? (res.data ?? null) : null } : r
          )
        )
      })
    }
  }

  const toggleSelect = (idx: number): void => {
    setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)))
  }

  const handleAddSelected = async (): Promise<void> => {
    setAdding(true)
    for (const item of results.filter((r) => r.selected)) {
      const game: Game = {
        uuid: generateUUID(),
        id: item.code,
        title: (item.info?.title as string) || item.code,
        circle: (item.info?.circle as string) || '',
        tags: (item.info?.tags as string[]) || [],
        cover: (item.info?.localCover as string) || null,
        coverUrl: (item.info?.coverUrl as string) || null,
        sampleImages: (item.info?.sampleImages as string[]) || [],
        path: item.isDir ? item.path : null,
        exe: !item.isDir && item.path.endsWith('.exe') ? item.path : null,
        rating: 0,
        note: '',
        addedAt: localDateTime(),
        language: 'ja',
        releaseDate: null,
        workType: null,
        dlsiteRating: null,
        lastPlayedAt: null,
        playCount: 0,
        playTime: 0,
        isFavorite: false
      }
      await onAdd(game)
    }
    setAdding(false)
    onClose()
  }

  const selectedCount = results.filter((r) => r.selected).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>批量掃描資料夾</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <input placeholder="選擇要掃描的資料夾" value={folderPath} readOnly />
            <button onClick={handleSelectFolder} disabled={scanning}>
              {scanning ? '掃描中...' : '選擇資料夾並掃描'}
            </button>
          </div>

          {results.length > 0 && (
            <>
              <div className="scan-info">
                找到 {results.length} 個新遊戲，已選 {selectedCount} 個
                <button
                  className="btn-sm"
                  onClick={() => setResults((r) => r.map((x) => ({ ...x, selected: true })))}
                >
                  全選
                </button>
                <button
                  className="btn-sm"
                  onClick={() => setResults((r) => r.map((x) => ({ ...x, selected: false })))}
                >
                  取消全選
                </button>
              </div>
              <div className="scan-list">
                {results.map((item, idx) => (
                  <div
                    key={item.code}
                    className={`scan-row ${item.selected ? 'selected' : ''}`}
                    onClick={() => toggleSelect(idx)}
                  >
                    <input type="checkbox" checked={item.selected} readOnly />
                    <span className="scan-code">{item.code}</span>
                    <span className="scan-title">
                      {item.fetching ? '載入中...' : (item.info?.title as string) || item.name}
                    </span>
                    <span className="scan-circle">{(item.info?.circle as string) || ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {results.length === 0 && folderPath && !scanning && (
            <div className="empty">未找到含有 RJ/VJ 代碼的遊戲，或都已加入庫中</div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={handleAddSelected}
            disabled={selectedCount === 0 || adding}
          >
            {adding ? '新增中...' : `新增 ${selectedCount} 個遊戲`}
          </button>
        </div>
      </div>
    </div>
  )
}
