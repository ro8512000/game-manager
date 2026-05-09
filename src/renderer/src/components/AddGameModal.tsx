import { useState, useEffect, useRef } from 'react'
import { localDateTime, generateUUID } from '../utils'
import type { Game } from '../types'
import type { PreviewMoveResult, PreviewExtractResult } from '../electron.d'

function nextNFCode(existingIds: string[]): string {
  const nums = existingIds
    .filter((id) => /^NF\d+$/i.test(id))
    .map((id) => parseInt(id.slice(2), 10))
    .filter((n) => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `NF${String(max + 1).padStart(3, '0')}`
}

interface FileState {
  path: string
  type: 'exe' | 'archive'
  code: string | null
  fetchingInfo: boolean
  info: Record<string, unknown> | null
  previewing: boolean
  movePreview: PreviewMoveResult | null
  extractPreview: PreviewExtractResult | null
}

interface Props {
  initialFile: { path: string; type: 'exe' | 'archive'; code: string | null }
  onAdd: (game: Game) => Promise<void>
  onClose: () => void
  existingIds: string[]
  gamesDir: string | null
  onOpenSettings: () => void
}

export default function AddGameModal({
  initialFile,
  onAdd,
  onClose,
  existingIds,
  gamesDir,
  onOpenSettings
}: Props): React.JSX.Element {
  const [file, setFile] = useState<FileState | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null)
  const initialized = useRef(false)
  const noAutoCode = !initialFile.code
  const [manualDlsite, setManualDlsite] = useState('')
  const [manualSteam, setManualSteam] = useState('')
  const [applyingCode, setApplyingCode] = useState(false)
  const [skipMove, setSkipMove] = useState(false)

  useEffect(() => {
    return window.electronAPI.onProgress((data) => setProgress(data))
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const { path, type, code } = initialFile

    if (code && existingIds.includes(code)) {
      setError(`⚠ ${code} 已存在於遊戲庫中，將作為副本加入`)
      // Don't return — allow adding
    }

    setFile({
      path,
      type,
      code,
      fetchingInfo: !!code,
      info: null,
      previewing: !!gamesDir,
      movePreview: null,
      extractPreview: null
    })

    // Fetch info and preview in parallel
    const tasks: Promise<void>[] = []

    if (code) {
      tasks.push(
        window.electronAPI.fetchInfo(code).then((r) => {
          setFile((f) => f ? { ...f, fetchingInfo: false, info: r.success ? (r.data ?? null) : null } : f)
        })
      )
    }

    if (gamesDir) {
      if (type === 'exe') {
        tasks.push(
          window.electronAPI.previewMove({ exePath: path, gamesDir }).then((preview) => {
            setFile((f) => f ? { ...f, previewing: false, movePreview: preview } : f)
          })
        )
      } else {
        tasks.push(
          window.electronAPI.previewExtract({ archivePath: path, gamesDir }).then((preview) => {
            setFile((f) => f ? { ...f, previewing: false, extractPreview: preview } : f)
          })
        )
      }
    } else {
      setFile((f) => f ? { ...f, previewing: false } : f)
    }

    Promise.all(tasks).catch(() => { /* ignore */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAdd = async (): Promise<void> => {
    if (!file) return
    setProcessing(true)
    setError('')
    setProgress(null)

    const code = file.code
    const id = code || nextNFCode(existingIds)
    let gamePath: string | null = null
    let exePath: string | null = null

    if (gamesDir && !(file.type === 'exe' && skipMove)) {
      if (file.type === 'exe') {
        const result = await window.electronAPI.moveToLibrary({ exePath: file.path, gamesDir })
        if (!result.success) {
          setError('移動檔案失敗：' + result.error)
          setProcessing(false)
          return
        }
        exePath = result.exePath ?? null
        gamePath = result.folderPath ?? null
      } else {
        const result = await window.electronAPI.extractArchive({ archivePath: file.path, gamesDir })
        if (!result.success) {
          setError('解壓縮失敗：' + result.error)
          setProcessing(false)
          return
        }
        gamePath = result.extractDir ?? null
        // Auto-find exe in extracted folder
        if (gamePath) exePath = await window.electronAPI.findExe(gamePath)
      }
    } else if (file.type === 'exe') {
      exePath = file.path
      const sep = file.path.includes('\\') ? '\\' : '/'
      gamePath = file.path.substring(0, file.path.lastIndexOf(sep)) || null
    }

    // Calculate folder size immediately after add
    const folderSize = gamePath ? await window.electronAPI.getFolderSize(gamePath) : null

    const info = file.info

    // Derive a readable title from the file path when no info was fetched
    const parts = file.path.replace(/\\/g, '/').split('/')
    const pathTitle = file.type === 'exe'
      ? (parts[parts.length - 2] || parts[parts.length - 1])
      : (parts[parts.length - 1].replace(/\.[^/.]+$/, '') || parts[parts.length - 1])

    const game: Game = {
      uuid: generateUUID(),
      id,
      title: (info?.title as string) || pathTitle,
      circle: (info?.circle as string) || '',
      tags: (info?.tags as string[]) || [],
      cover: (info?.localCover as string) || null,
      listImage: (info?.localListImage as string) || null,
      coverUrl: (info?.coverUrl as string) || null,
      sampleImages: (info?.sampleImages as string[]) || [],
      releaseDate: (info?.releaseDate as string) || null,
      workType: (info?.workType as string) || null,
      dlsiteRating: (info?.dlsiteRating as string) || null,
      path: gamePath,
      exe: exePath,
      rating: 0,
      note: '',
      addedAt: localDateTime(),
      language: 'ja',
      lastPlayedAt: null,
      playCount: 0,
      playTime: 0,
      isFavorite: false,
      folderSize,
      launchLocale: null
    }

    await onAdd(game)
    setProcessing(false)
    onClose()
  }

  const handleApplyDlsite = async (): Promise<void> => {
    const code = manualDlsite.trim().toUpperCase()
    if (!code.match(/^[RVB]J\d{6,8}$/i)) return
    setApplyingCode(true)
    setFile((f) => f ? { ...f, code, fetchingInfo: true, info: null } : f)
    const r = await window.electronAPI.fetchInfo(code)
    setFile((f) => f ? { ...f, fetchingInfo: false, info: r.success ? (r.data ?? null) : null } : f)
    setApplyingCode(false)
  }

  const handleApplySteam = async (): Promise<void> => {
    const appId = manualSteam.trim()
    if (!appId.match(/^\d+$/)) return
    const steamCode = `ST${appId}`
    setApplyingCode(true)
    setFile((f) => f ? { ...f, code: steamCode, fetchingInfo: true, info: null } : f)
    const r = await window.electronAPI.fetchSteamInfo(appId)
    setFile((f) => f ? { ...f, fetchingInfo: false, info: r.success ? (r.data ?? null) : null } : f)
    setApplyingCode(false)
  }

  const coverUrl = file?.info?.coverUrl as string | undefined
  const previewSrc = coverUrl
    ? coverUrl.startsWith('//') ? `https:${coverUrl}` : coverUrl
    : null

  const fileNeedsGamesDir = !!file && !gamesDir && file.type === 'archive'
  const isLoading = file ? (file.fetchingInfo || file.previewing) : false
  const canAdd = !!file && !processing && !fileNeedsGamesDir && !isLoading

  if (!file) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body" style={{ alignItems: 'center', padding: '32px' }}>
            <div className="file-preview-info analyzing">準備中...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>新增遊戲</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* File path */}
          <div className="file-preview">
            <div className="file-preview-path">
              {file.type === 'exe' ? '📁' : '📦'} {file.path}
            </div>
            <div className="file-preview-info">
              <span className="stat-label">偵測代碼</span>
              {file.code
                ? <span className="preview-dest">{file.code}</span>
                : <span className="preview-dest nf-code">將指派代碼 {nextNFCode(existingIds)}</span>
              }
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          {/* Manual code entry when no code was auto-detected */}
          {noAutoCode && (
            <div className="manual-code-section">
              <div className="manual-code-row">
                <span className="stat-label">DLsite 代碼</span>
                <input
                  className="manual-code-input"
                  placeholder="RJ000000"
                  value={manualDlsite}
                  onChange={(e) => setManualDlsite(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyDlsite()}
                  disabled={applyingCode}
                />
                <button
                  className="manual-code-apply"
                  onClick={handleApplyDlsite}
                  disabled={!manualDlsite.trim() || applyingCode}
                >套用</button>
              </div>
              <div className="manual-code-row">
                <span className="stat-label">Steam App ID</span>
                <input
                  className="manual-code-input"
                  placeholder="2074890"
                  value={manualSteam}
                  onChange={(e) => setManualSteam(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplySteam()}
                  disabled={applyingCode}
                />
                <button
                  className="manual-code-apply"
                  onClick={handleApplySteam}
                  disabled={!manualSteam.trim() || applyingCode}
                >套用</button>
              </div>
            </div>
          )}

          {/* DLsite info */}
          {file.code && (
            file.fetchingInfo ? (
              <div className="file-preview-info analyzing">正在從 DLsite 抓取遊戲資訊...</div>
            ) : file.info ? (
              <div className="info-preview">
                {previewSrc && <img src={previewSrc} alt="" className="preview-cover" />}
                <div className="info-detail">
                  <div className="info-title">{file.info.title as string}</div>
                  <div className="info-circle">{file.info.circle as string}</div>
                  {(file.info.releaseDate as string) && (
                    <div className="info-circle">{file.info.releaseDate as string}</div>
                  )}
                  <div className="info-tags">
                    {(file.info.tags as string[])?.slice(0, 5).join(' / ')}
                  </div>
                  {((file.info.sampleImages as string[])?.length ?? 0) > 0 && (
                    <div className="info-circle">
                      已下載 {(file.info.sampleImages as string[]).length} 張圖片
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="file-preview-info warn">無法取得 DLsite 資訊（仍可新增）</div>
            )
          )}

          {/* File operation preview */}
          {file.previewing && gamesDir && (
            <div className="file-preview-info analyzing">分析中...</div>
          )}

          {!file.previewing && file.type === 'exe' && gamesDir && (
            <div className="file-preview">
              <label className="skip-move-label">
                <input
                  type="checkbox"
                  checked={skipMove}
                  onChange={(e) => setSkipMove(e.target.checked)}
                />
                不搬移資料夾（直接記錄原始路徑）
              </label>
              {!skipMove && file.movePreview && (
                <div className="file-preview-info">
                  <span className="preview-arrow">移動</span>
                  <span className="preview-src">{file.movePreview.srcFolder}</span>
                  <span className="preview-arrow">→</span>
                  <span className="preview-dest">{file.movePreview.destFolder}</span>
                </div>
              )}
            </div>
          )}

          {!file.previewing && file.type === 'archive' && file.extractPreview && gamesDir && (
            <div className="file-preview">
              <div className="file-preview-info">
                <span className="preview-arrow">解壓縮至</span>
                <span className="preview-dest">{file.extractPreview.destFolder}</span>
                <span className="preview-badge">
                  {file.extractPreview.method === 'filename' && '從檔名偵測'}
                  {file.extractPreview.method === 'archive' && '從壓縮檔偵測'}
                  {file.extractPreview.method === 'name' && '使用檔案名稱'}
                </span>
              </div>
            </div>
          )}

          {progress && (
            <div className="progress-container">
              <div className="progress-step-msg">{progress.msg}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="progress-pct">{progress.pct}%</div>
            </div>
          )}

          {fileNeedsGamesDir && (
            <div className="file-preview-info warn">
              解壓縮需要設定遊戲儲存目錄。
              <button className="link-btn" onClick={onOpenSettings}>前往設定</button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} disabled={processing}>取消</button>
          <button className="primary" onClick={handleAdd} disabled={!canAdd}>
            {processing ? '處理中...' : '新增遊戲'}
          </button>
        </div>
      </div>
    </div>
  )
}
