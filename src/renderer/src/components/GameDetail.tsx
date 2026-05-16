import { useState, useEffect } from 'react'
import type { Game } from '../types'
import { localDateTime, formatPlayTime, formatFileSize } from '../utils'
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(game.title)
  const [editingId, setEditingId] = useState(false)
  const [idInput, setIdInput] = useState(game.id)
  const [refetching, setRefetching] = useState(false)
  const [refetchProgress, setRefetchProgress] = useState<{ msg: string; pct: number } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [tagEditMode, setTagEditMode] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(0)
  const [imgEditMode, setImgEditMode] = useState(false)

  useEffect(() => {
    setNote(game.note)
    setRating(game.rating)
    setEditableTags(game.tags)
    setEditingTitle(false)
    setTitleInput(game.title)
    setEditingId(false)
    setIdInput(game.id)
    setRefetching(false)
    setRefetchProgress(null)
    setTagInput('')
    setShowTagSuggestions(false)
    setTagEditMode(false)
    setActiveIdx(0)
    setShowDeleteDialog(false)
    setDeleteFiles(false)
    setImgEditMode(false)

    const isSteamGame = game.id.startsWith('ST')
    // Steam: index 0=cover, 1+=sampleImages; others: 0=cover, 1=listImage, 2+=sampleImages
    const allPaths = isSteamGame
      ? [game.cover, ...(game.sampleImages ?? [])]
      : [game.cover, game.listImage, ...(game.sampleImages ?? [])]
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

  useEffect(() => {
    return window.electronAPI.onProgress((data) => setRefetchProgress(data))
  }, [])

  useEffect(() => {
    const total = (game.id.startsWith('ST') ? 1 : 2) + (game.sampleImages?.length ?? 0)
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (total <= 1) return
      e.preventDefault()
      setActiveIdx((prev) => {
        const delta = e.key === 'ArrowRight' ? 1 : -1
        return (prev + delta + total) % total
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [game.id, game.sampleImages?.length])

  const handleSaveId = (): void => {
    setEditingId(false)
    const newId = idInput.trim().toUpperCase()
    if (newId && newId !== game.id) onUpdate({ ...game, id: newId })
  }

  const handleRefetchInfo = async (): Promise<void> => {
    const isRJ = /^[RVB]J\d{6,8}$/i.test(game.id)
    const isST = game.id.startsWith('ST')
    const isGC = game.id.startsWith('GC')
    if (!isRJ && !isST && !isGC || refetching) return
    setRefetching(true)
    setRefetchProgress(null)
    const result = isST
      ? await window.electronAPI.fetchSteamInfo(game.id.slice(2))
      : isGC
        ? await window.electronAPI.fetchGetchuInfo(game.id.slice(2))
        : await window.electronAPI.fetchInfo(game.id)
    if (result.success && result.data) {
      const d = result.data
      onUpdate({
        ...game,
        title: (d.title as string) || game.title,
        circle: (d.circle as string) || game.circle,
        tags: (d.tags as string[]) || game.tags,
        cover: (d.localCover as string) || game.cover,
        listImage: (d.localListImage as string) || game.listImage,
        coverUrl: (d.coverUrl as string) || game.coverUrl,
        sampleImages: (d.sampleImages as string[]) || game.sampleImages,
        releaseDate: (d.releaseDate as string) || game.releaseDate,
        workType: (d.workType as string) || game.workType,
        dlsiteRating: (d.dlsiteRating as string) || game.dlsiteRating,
      })
    }
    setRefetching(false)
  }

  const handleRefreshSize = async (): Promise<void> => {
    if (!game.path) return
    const size = await window.electronAPI.getFolderSize(game.path)
    if (size !== null) onUpdate({ ...game, folderSize: size })
  }

  const isSteam = game.id.startsWith('ST')
  const coverFallback = game.coverUrl
    ? game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl
    : null
  const listImgFallback = (!isSteam && game.coverUrl)
    ? (() => { const u = (game.coverUrl.startsWith('//') ? `https:${game.coverUrl}` : game.coverUrl).replace('_img_main', '_img_sam'); return u })()
    : null
  const activeImgSrc = imgSrcs[activeIdx] ?? (activeIdx === 0 ? coverFallback : (!isSteam && activeIdx === 1) ? listImgFallback : null)

  const handleLaunch = async (): Promise<void> => {
    let exeToLaunch = game.exe
    if (!exeToLaunch && game.path) {
      exeToLaunch = await window.electronAPI.findExe(game.path)
    }
    if (!exeToLaunch) return

    window.electronAPI.launchGame({ exePath: exeToLaunch, gameId: game.id, locale: game.launchLocale })

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

  const handleOpenImagesFolder = (): void => {
    const imgPath = game.cover || game.listImage || game.sampleImages?.[0]
    if (imgPath) {
      const folder = imgPath.replace(/[/\\][^/\\]+$/, '')
      window.electronAPI.openFolder(folder)
    }
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

  const handleUploadCover = async (): Promise<void> => {
    const newPath = await window.electronAPI.uploadImage(game.id, 'cover')
    if (!newPath) return
    onUpdate({ ...game, cover: newPath })
    window.electronAPI.getImageData(newPath).then((data) => {
      setImgSrcs((prev) => { const next = [...prev]; next[0] = data; return next })
    })
  }

  const handleUploadListImage = async (): Promise<void> => {
    const newPath = await window.electronAPI.uploadImage(game.id, 'listImage')
    if (!newPath) return
    onUpdate({ ...game, listImage: newPath })
    window.electronAPI.getImageData(newPath).then((data) => {
      setImgSrcs((prev) => { const next = [...prev]; next[1] = data; return next })
    })
  }

  const handleUploadSample = async (): Promise<void> => {
    const newPath = await window.electronAPI.uploadImage(game.id, 'sample')
    if (!newPath) return
    const newSamples = [...(game.sampleImages ?? []), newPath]
    onUpdate({ ...game, sampleImages: newSamples })
    window.electronAPI.getImageData(newPath).then((data) => {
      setImgSrcs((prev) => [...prev, data])
    })
  }

  const handleDeleteImage = async (idx: number): Promise<void> => {
    if (idx === 0) {
      if (game.cover) await window.electronAPI.deleteFile(game.cover)
      onUpdate({ ...game, cover: null })
      setImgSrcs((prev) => { const next = [...prev]; next[0] = null; return next })
    } else if (!isSteam && idx === 1) {
      if (game.listImage) await window.electronAPI.deleteFile(game.listImage)
      onUpdate({ ...game, listImage: null })
      setImgSrcs((prev) => { const next = [...prev]; next[1] = null; return next })
      if (activeIdx === 1) setActiveIdx(0)
    } else {
      const sampleIdx = isSteam ? idx - 1 : idx - 2
      const path = game.sampleImages?.[sampleIdx]
      if (path) await window.electronAPI.deleteFile(path)
      const newSamples = (game.sampleImages ?? []).filter((_, i) => i !== sampleIdx)
      onUpdate({ ...game, sampleImages: newSamples })
      setImgSrcs((prev) => prev.filter((_, i) => i !== idx))
      if (activeIdx >= idx) setActiveIdx(Math.max(0, activeIdx - 1))
    }
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

  const totalImages = (isSteam ? 1 : 2) + (game.sampleImages?.length ?? 0)

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
        {!imgEditMode && activeIdx === 0 && (
          <button className="btn-upload-cover" title="上傳封面圖" onClick={(e) => { e.stopPropagation(); handleUploadCover() }}>
            ↑ 上傳封面
          </button>
        )}
        {!isSteam && !imgEditMode && activeIdx === 1 && (
          <button className="btn-upload-cover" title="上傳列表縮圖" onClick={(e) => { e.stopPropagation(); handleUploadListImage() }}>
            ↑ 上傳縮圖
          </button>
        )}
        {imgEditMode && activeIdx === 0 && (game.cover || activeImgSrc) && (
          <button className="btn-delete-img-cover" title="刪除封面圖" onClick={(e) => { e.stopPropagation(); handleDeleteImage(0) }}>
            × 刪除封面
          </button>
        )}
        {!isSteam && imgEditMode && activeIdx === 1 && (
          <button className="btn-delete-img-cover" title="刪除縮圖" onClick={(e) => { e.stopPropagation(); handleDeleteImage(1) }}>
            × 刪除縮圖
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className="detail-thumbnails-wrap">
        <div className="detail-thumbnails">
          {Array.from({ length: totalImages }, (_, i) => (
            <div key={i} className="thumb-wrap">
              <button
                className={`thumb-btn ${activeIdx === i ? 'active' : ''}`}
                onClick={() => { setActiveIdx(i) }}
              >
                {imgSrcs[i]
                  ? <img src={imgSrcs[i]!} alt={`img ${i + 1}`} />
                  : <div className="thumb-placeholder" />
                }
                {!isSteam && i === 1 && <span className="thumb-label-badge">縮圖</span>}
              </button>
              {imgEditMode && (
                <button className="thumb-delete-btn" onClick={() => handleDeleteImage(i)} title="刪除">×</button>
              )}
            </div>
          ))}
          {!imgEditMode && (
            <button className="thumb-btn thumb-upload" onClick={handleUploadSample} title="上傳樣本圖">+</button>
          )}
        </div>
        <button
          className={`thumb-edit-toggle ${imgEditMode ? 'active' : ''}`}
          onClick={() => setImgEditMode((v) => !v)}
          title={imgEditMode ? '完成' : '管理圖片'}
        >
          {imgEditMode ? '完成' : '✎'}
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-id-row">
          {editingId ? (
            <input
              className="detail-id-input"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value.toUpperCase())}
              onBlur={handleSaveId}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setIdInput(game.id); setEditingId(false) } }}
              autoFocus
            />
          ) : (
            <span className="detail-id editable" onClick={() => setEditingId(true)} title="點擊編輯代碼">{game.id}</span>
          )}
          {(/^[RVB]J\d{6,8}$/i.test(game.id) || game.id.startsWith('ST') || game.id.startsWith('GC')) && (
            <button
              className="btn-refetch"
              onClick={handleRefetchInfo}
              disabled={refetching}
              title="重新抓取遊戲資訊"
            >
              {refetching ? '⌛' : '↻'}
            </button>
          )}
          <button
            className={`btn-favorite ${game.isFavorite ? 'active' : ''}`}
            onClick={() => onUpdate({ ...game, isFavorite: !game.isFavorite })}
            title={game.isFavorite ? '取消我的最愛' : '加入我的最愛'}
          >
            {game.isFavorite ? '♥' : '♡'}
          </button>
          {game.id.match(/^[RVB]J\d{6,8}$/i) && (
            <button className="btn-dlsite" onClick={() => window.electronAPI.openExternal(getDLsiteUrl(game.id))}>DLsite ↗</button>
          )}
          {game.id.startsWith('ST') && (
            <button className="btn-dlsite" onClick={() => window.electronAPI.openExternal(`https://store.steampowered.com/app/${game.id.slice(2)}/`)}>Steam ↗</button>
          )}
          {game.id.startsWith('GC') && (
            <button className="btn-dlsite" onClick={() => window.electronAPI.openExternal(`https://www.getchu.com/item/${game.id.slice(2)}`)}>Getchu ↗</button>
          )}
        </div>
        {refetching && refetchProgress && (
          <div className="refetch-progress">
            <div className="progress-step-msg">{refetchProgress.msg}</div>
            <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${refetchProgress.pct}%` }} /></div>
          </div>
        )}
        {editingTitle ? (
          <input
            className="detail-title-input"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={() => {
              setEditingTitle(false)
              const t = titleInput.trim()
              if (t && t !== game.title) onUpdate({ ...game, title: t, note, rating, tags: editableTags })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { setTitleInput(game.title); setEditingTitle(false) }
            }}
            autoFocus
          />
        ) : (
          <div className="detail-title editable" onClick={() => setEditingTitle(true)} title="點擊編輯標題">
            {game.title || game.id}
          </div>
        )}
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
          {(game.cover || game.listImage || game.sampleImages?.[0]) && (
            <button className="btn-folder" onClick={handleOpenImagesFolder} title="開啟圖片資料夾">🖼 圖片資料夾</button>
          )}
          <button className="btn-set-exe" onClick={handleSetExe} title="選擇此遊戲的啟動exe">
            ⚙ 啟動檔案
          </button>
        </div>
        <div className="exe-path-display" title={game.exe || ''}>
          {game.exe || <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>未設定啟動檔案</span>}
        </div>

        <div className="launch-locale-row">
          <span className="launch-locale-label">啟動語系</span>
          <select
            className="locale-select"
            value={game.launchLocale ?? ''}
            onChange={(e) => onUpdate({ ...game, launchLocale: e.target.value || null })}
          >
            <option value="">正常啟動</option>
            <option value="ja">日語 (Locale Emulator)</option>
            <option value="zh-TW">繁體中文 (Locale Emulator)</option>
            <option value="zh-CN">簡體中文 (Locale Emulator)</option>
            <option value="ko">韓語 (Locale Emulator)</option>
          </select>
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
          <div className="stat-row">
            <span className="stat-label">磁碟大小</span>
            <span className="stat-value stat-with-btn">
              {game.folderSize != null ? formatFileSize(game.folderSize) : '未計算'}
              {game.path && (
                <button className="btn-stat-refresh" onClick={handleRefreshSize} title="重新計算大小">↻</button>
              )}
            </span>
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
