import { useState, useEffect, useRef } from 'react'
import type { Game } from '../types'
import { localDateTime } from '../utils'

interface Props {
  games: Game[]          // filtered DLsite games to re-fetch
  onUpdate: (game: Game) => Promise<void>
  onClose: () => void
}

export default function BatchFetchModal({ games, onUpdate, onClose }: Props): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [stepMsg, setStepMsg] = useState('')
  const [stepPct, setStepPct] = useState(0)
  const [done, setDone] = useState(false)
  const [successCount, setSuccessCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    return window.electronAPI.onProgress(({ msg, pct }) => {
      setStepMsg(msg)
      setStepPct(pct)
    })
  }, [])

  const handleStart = async (): Promise<void> => {
    setRunning(true)
    cancelledRef.current = false
    let ok = 0
    let err = 0

    for (let i = 0; i < games.length; i++) {
      if (cancelledRef.current) break
      setCurrentIdx(i)
      setStepMsg('抓取中...')
      setStepPct(0)
      const game = games[i]
      try {
        const result = await window.electronAPI.fetchInfo(game.id)
        if (result.success && result.data) {
          const d = result.data
          await onUpdate({
            ...game,
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
          ok++
        } else {
          err++
        }
      } catch {
        err++
      }
    }

    setSuccessCount(ok)
    setErrorCount(err)
    setRunning(false)
    setDone(true)
  }

  const handleCancel = (): void => {
    cancelledRef.current = true
  }

  const totalCount = games.length
  const overallPct = totalCount > 0 ? Math.round((currentIdx / totalCount) * 100) : 0

  return (
    <div className="modal-overlay" onClick={done || !running ? onClose : undefined}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>批量更新 DLsite 資訊</h2>
          {!running && <button onClick={onClose}>✕</button>}
        </div>

        <div className="modal-body" style={{ gap: 14 }}>
          {!running && !done && (
            <>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                將對當前列表中的 <strong style={{ color: 'var(--text)' }}>{totalCount} 款 DLsite 遊戲</strong>重新抓取資訊，
                包括標題、社團、標籤、封面圖、評分等。
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                處理順序：逐筆依序抓取（不會同時發送多個請求）。
              </div>
            </>
          )}

          {running && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                整體進度：{currentIdx + 1} / {totalCount}
                <span style={{ marginLeft: 8, color: 'var(--accent)' }}>{games[currentIdx]?.id}</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${overallPct}%`, background: 'var(--accent)' }} />
              </div>

              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{stepMsg}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${stepPct}%` }} />
              </div>
            </>
          )}

          {done && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="import-stat-row">
                <span>成功更新</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{successCount} 款</span>
              </div>
              {errorCount > 0 && (
                <div className="import-stat-row">
                  <span>失敗（可能 DLsite 無此作品）</span>
                  <span style={{ color: 'var(--text2)' }}>{errorCount} 款</span>
                </div>
              )}
              {cancelledRef.current && (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>（已在第 {currentIdx + 1} 筆時取消）</div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!running && !done && (
            <>
              <button onClick={onClose}>取消</button>
              <button className="primary" onClick={handleStart} disabled={totalCount === 0}>
                開始更新 {totalCount} 款
              </button>
            </>
          )}
          {running && (
            <button onClick={handleCancel}>停止</button>
          )}
          {done && (
            <button className="primary" onClick={onClose}>完成</button>
          )}
        </div>
      </div>
    </div>
  )
}
