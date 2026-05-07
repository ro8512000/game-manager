import { useState, useEffect } from 'react'
import type { Game } from '../types'
import { localDateTime, formatPlayTime } from '../utils'
import ImageLightbox from './ImageLightbox'

interface Props {
  game: Game
  onUpdate: (game: Game) => void
  onDelete: (id: string) => void
  onClose: () => void
  onFilterTag: (tag: string) => void
  allTags: string[]
}

function getDLsiteUrl(id: string): string {
  if (id.startsWith('VJ')) return `https://www.dlsite.com/home/work/=/product_id/${id}.html`
  if (id.startsWith('BJ')) return `https://www.dlsite.com/boys-love/work/=/product_id/${id}.html`
  return `https://www.dlsite.com/maniax/work/=/product_id/${id}.html`
}

export default function GameDetail({ game, onUpdate, onDelete, onClose, onFilterTag, allTags }: Props): React.JSX.Element {
  const [imgSrcs, setImgSrcs] = useState<(string | null)[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [note, setNote] = useState(game.note)
  const [rating, setRating] = useState(game.rating)
  const [editableTags, setEditableTags] = useState<string[]>(game.tags)
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [tagEditMode, setTagEditMode] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(0)

  useEffect(() => {
    setNote(game.note)
    setRating(game.rating)
    setEditableTags(game.tags)
    setTagInput('')
    setShowTagSuggestions(false)
    setTagEditMode(false)
    setActiveIdx(0)
    setShowDeleteDialog(false)
    setDeleteFiles(false)

    const allPaths = [game.cover, ...(game.sampleImages ?? [])]
    setImgSrcs(new Array(allPaths.length).fill(null))

    allPaths.forEach((imgPath, i) => {
      if (!imgPath) return
      window.electronAPI.getImageData(imgPath).then((data) => {
        setImgSrcs((prev) => {
          const next = [...prev]
          next[i] = data
          return next
        })
      })
    })
  }, [game])

  const coverFallback = game.coverUrl
    ? game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl
    : null
  const activeImgSrc = imgSrcs[activeIdx] ?? (activeIdx === 0 ? coverFallback : null)

  const handleLaunch = async (): Promise<void> => {
    let exeToLaunch = game.exe
    if (!exeToLaunch && game.path) {
      exeToLaunch = await window.electronAPI.findExe(game.path)
    }
    if (!exeToLaunch) return

    window.electronAPI.launchGame({ exePath: exeToLaunch, gameId: game.id })

    const updated: Game = {
      ...game,
      lastPlayedAt: localDateTime(),
      playCount: (game.playCount ?? 0) + 1
    }
    if (!game.exe && exeToLaunch) updated.exe = exeToLaunch
    onUpdate(updated)
  }

  const handleOpenFolder = (): void => {
    if (game.path) window.electronAPI.openFolder(game.path)
  }

  const handleSetExe = async (): Promise<void> => {
    const startPath = game.exe || game.path || ''
    const newExe = await window.electronAPI.selectExeFrom(startPath)
    if (newExe) onUpdate({ ...game, exe: newExe })
  }

  const openLightbox = (idx: number): void => {
    setLightboxIdx(idx)
    setLightboxOpen(true)
  }

  const addTag = (tag: string): void => {
    const t = tag.trim()
    if (t && !editableTags.includes(t)) {
      const newTags = [...editableTags, t]
      setEditableTags(newTags)
      setTagInput('')
      setShowTagSuggestions(false)
      onUpdate({ ...game, note, rating, tags: newTags })
    }
  }

  const removeTag = (tag: string): void => {
    const newTags = editableTags.filter((x) => x !== tag)
    setEditableTags(newTags)
    onUpdate({ ...game, note, rating, tags: newTags })
  }

  const tagSuggestions = tagInput
    ? allTags.filter((t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !editableTags.includes(t)).slice(0, 6)
    : []

  const handleSaveNote = (): void => {
    onUpdate({ ...game, note, rating, tags: editableTags })
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (deleteFiles && game.path) {
      await window.electronAPI.deleteFolder(game.path)
    }
    onDelete(game.uuid)
  }

  const totalImages = 1 + (game.sampleImages?.length ?? 0)

  return (
    <aside className="detail-panel">
      <button className="detail-close" onClick={onClose}>✕</button>

      {/* Main image — click to open lightbox */}
      <div
        className="detail-cover"
        style={{ cursor: activeImgSrc ? 'zoom-in' : 'default' }}
        onClick={() => activeImgSrc && openLightbox(activeIdx)}
      >
        {activeImgSrc
          ? <img src={activeImgSrc} alt={game.title} />
          : <div className="no-cover large">{game.id}</div>
        }
      </div>

      {/* Thumbnail strip */}
      {totalImages > 1 && (
        <div className="detail-thumbnails">
          {Array.from({ length: totalImages }, (_, i) => (
            <button
              key={i}
              className={`thumb-btn ${activeIdx === i ? 'active' : ''}`}
              onClick={() => { setActiveIdx(i) }}
            >
              {imgSrcs[i]
                ? <img src={imgSrcs[i]!} alt={`img ${i + 1}`} />
                : <div className="thumb-placeholder" />
              }
            </button>
          ))}
        </div>
      )}

      <div className="detail-body">
        <div className="detail-id-row">
          <span className="detail-id">{game.id}</span>
          <button
            className={`btn-favorite ${game.isFavorite ? 'active' : ''}`}
            onClick={() => onUpdate({ ...game, isFavorite: !game.isFavorite })}
            title={game.isFavorite ? '取消我的最愛' : '加入我的最愛'}
          >
            {game.isFavorite ? '♥' : '♡'}
          </button>
          {game.id.match(/^[RVB]J\d{6,8}$/i) && (
            <button
              className="btn-dlsite"
              onClick={() => window.electronAPI.openExternal(getDLsiteUrl(game.id))}
            >
              DLsite ↗
            </button>
          )}
        </div>
        <div className="detail-title">{game.title || game.id}</div>
        <div className="detail-circle">{game.circle}</div>
        {game.workType && <div className="detail-worktype">{game.workType}</div>}

        <div className="detail-rating">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              className={`star ${s <= rating ? 'filled' : ''}`}
              onClick={() => setRating(s === rating ? 0 : s)}
            >★</button>
          ))}
        </div>

        <div className="detail-tag-editor">
          <div className="detail-tag-header">
            <div className="detail-tags">
              {editableTags.map((t) => (
                <span key={t} className="tag tag-editable">
                  {tagEditMode && (
                    <button className="tag-remove" onClick={() => removeTag(t)}>×</button>
                  )}
                  <span
                    className="tag-label"
                    onClick={() => !tagEditMode && onFilterTag(t)}
                    title={tagEditMode ? '' : `篩選：${t}`}
                    style={{ cursor: tagEditMode ? 'default' : 'pointer' }}
                  >{t}</span>
                </span>
              ))}
            </div>
            <button
              className={`tag-mode-btn ${tagEditMode ? 'active' : ''}`}
              onClick={() => { setTagEditMode(!tagEditMode); setTagInput(''); setShowTagSuggestions(false) }}
              title={tagEditMode ? '完成編輯' : '編輯標籤'}
            >
              {tagEditMode ? '完成' : '✎'}
            </button>
          </div>

          {tagEditMode && (
            <div className="tag-input-wrap">
              <input
                className="tag-input"
                placeholder="輸入標籤..."
                value={tagInput}
                onChange={(e) => { setTagInput(e.target.value); setShowTagSuggestions(true) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); addTag(tagInput) }
                  if (e.key === 'Escape') setShowTagSuggestions(false)
                }}
                onFocus={() => setShowTagSuggestions(true)}
                onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
              />
              <button className="tag-add-btn" onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}>+</button>
              {showTagSuggestions && tagSuggestions.length > 0 && (
                <div className="tag-suggestions">
                  {tagSuggestions.map((s) => (
                    <button key={s} className="tag-suggestion-item" onMouseDown={() => addTag(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="detail-actions">
          {(game.exe || game.path) && (
            <button className="btn-launch" onClick={handleLaunch}>▶ 啟動</button>
          )}
          {game.path && (
            <button className="btn-folder" onClick={handleOpenFolder}>📁 開啟資料夾</button>
          )}
          <button className="btn-set-exe" onClick={handleSetExe} title="選擇此遊戲的啟動exe">
            ⚙ 啟動檔案
          </button>
        </div>
        <div className="exe-path-display" title={game.exe || ''}>
          {game.exe || <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>未設定啟動檔案</span>}
        </div>

        <textarea
          className="detail-note"
          placeholder="個人備注..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="detail-footer">
          <button className="btn-save" onClick={handleSaveNote}>儲存備注</button>
          <button className="btn-delete" onClick={() => setShowDeleteDialog(true)}>移除</button>
        </div>

        <div className="detail-stats">
          {game.releaseDate && (
            <div className="stat-row">
              <span className="stat-label">發售日</span>
              <span className="stat-value">{game.releaseDate}</span>
            </div>
          )}
          {game.dlsiteRating && (
            <div className="stat-row">
              <span className="stat-label">DLsite 評分</span>
              <span className="stat-value">★ {game.dlsiteRating}</span>
            </div>
          )}
          <div className="stat-row">
            <span className="stat-label">加入時間</span>
            <span className="stat-value">{game.addedAt}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">遊玩次數</span>
            <span className="stat-value">{game.playCount ?? 0} 次</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">遊玩時間</span>
            <span className="stat-value">{formatPlayTime(game.playTime ?? 0)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">上次遊玩</span>
            <span className="stat-value">{game.lastPlayedAt ?? '從未遊玩'}</span>
          </div>
        </div>
      </div>

      {/* Image lightbox */}
      {lightboxOpen && (
        <ImageLightbox
          images={imgSrcs}
          activeIndex={lightboxIdx}
          onClose={() => setLightboxOpen(false)}
          onNavigate={(idx) => { setLightboxIdx(idx); setActiveIdx(idx) }}
        />
      )}

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div className="modal-overlay" onClick={() => setShowDeleteDialog(false)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>確認移除</h2>
              <button onClick={() => setShowDeleteDialog(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div>確定要移除《{game.title || game.id}》嗎？</div>
              {game.path && (
                <label className="delete-files-opt">
                  <input
                    type="checkbox"
                    checked={deleteFiles}
                    onChange={(e) => setDeleteFiles(e.target.checked)}
                  />
                  連同遊戲檔案一起刪除
                </label>
              )}
              {deleteFiles && game.path && (
                <div className="delete-warn">
                  ⚠ 將永久刪除：{game.path}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowDeleteDialog(false)}>取消</button>
              <button className="btn-delete" onClick={handleConfirmDelete}>確認移除</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
