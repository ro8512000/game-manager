import { useState, useMemo } from 'react'

type GameSource = 'dlsite' | 'steam' | 'getchu' | 'other'

const SOURCE_LABELS: Record<GameSource, string> = {
  dlsite: 'DLsite 遊戲',
  steam: 'Steam 遊戲',
  getchu: 'Getchu 遊戲',
  other: '其他遊戲'
}

interface Props {
  tags: string[]
  selectedTags: string[]
  favoriteTags: string[]
  filterRating: number
  filterSources: GameSource[]
  favoritesOnly: boolean
  ratingCollapsed: boolean
  sourceCollapsed: boolean
  gameCount: number
  onTagToggle: (tag: string) => void
  onClearTags: () => void
  onFavoriteTagToggle: (tag: string) => void
  onRatingChange: (r: number) => void
  onSourceToggle: (source: GameSource) => void
  onFavoritesChange: (v: boolean) => void
  onRatingCollapsedChange: (v: boolean) => void
  onSourceCollapsedChange: (v: boolean) => void
}

export default function Sidebar({
  tags,
  selectedTags,
  favoriteTags,
  filterRating,
  filterSources,
  favoritesOnly,
  ratingCollapsed,
  sourceCollapsed,
  gameCount,
  onTagToggle,
  onClearTags,
  onFavoriteTagToggle,
  onRatingChange,
  onSourceToggle,
  onFavoritesChange,
  onRatingCollapsedChange,
  onSourceCollapsedChange
}: Props): React.JSX.Element {
  const [tagSearch, setTagSearch] = useState('')

  const { favTags, nonFavTags } = useMemo(() => {
    const q = tagSearch.toLowerCase()
    const visible = q ? tags.filter((t) => t.toLowerCase().includes(q)) : tags
    const isFav = (t: string): boolean => favoriteTags.includes(t)
    const isSel = (t: string): boolean => selectedTags.includes(t)
    const fav = [
      ...visible.filter((t) => isFav(t) && isSel(t)),
      ...visible.filter((t) => isFav(t) && !isSel(t)),
    ]
    const nonFav = [
      ...visible.filter((t) => !isFav(t) && isSel(t)),
      ...visible.filter((t) => !isFav(t) && !isSel(t)),
    ]
    return { favTags: fav, nonFavTags: nonFav }
  }, [tags, selectedTags, favoriteTags, tagSearch])

  const allSources: GameSource[] = ['dlsite', 'steam', 'getchu', 'other']

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-label">遊戲數量</div>
        <div className="game-count">{gameCount}</div>
      </div>

      <div className="sidebar-section">
        <button
          className={`filter-btn fav-btn ${favoritesOnly ? 'active' : ''}`}
          onClick={() => onFavoritesChange(!favoritesOnly)}
        >
          {favoritesOnly ? '♥' : '♡'} 我的最愛
        </button>
      </div>

      <div className="sidebar-section">
        <button
          className="sidebar-collapsible-hdr"
          onClick={() => onSourceCollapsedChange(!sourceCollapsed)}
        >
          <span className="sidebar-label">來源</span>
          <span className="collapse-arrow">{sourceCollapsed ? '▸' : '▾'}</span>
        </button>
        {!sourceCollapsed && allSources.map((src) => (
          <button
            key={src}
            className={`filter-btn source-btn ${filterSources.includes(src) ? 'active' : ''}`}
            onClick={() => onSourceToggle(src)}
          >
            {filterSources.includes(src) ? '✓ ' : ''}{SOURCE_LABELS[src]}
          </button>
        ))}
      </div>

      <div className="sidebar-section">
        <button
          className="sidebar-collapsible-hdr"
          onClick={() => onRatingCollapsedChange(!ratingCollapsed)}
        >
          <span className="sidebar-label">評分篩選</span>
          <span className="collapse-arrow">{ratingCollapsed ? '▸' : '▾'}</span>
        </button>
        {!ratingCollapsed && (
          <>
            {[0, 1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                className={`filter-btn ${filterRating === r ? 'active' : ''}`}
                onClick={() => onRatingChange(r)}
              >
                {r === 0 ? '全部' : '★'.repeat(r) + '☆'.repeat(5 - r) + ' 以上'}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="sidebar-section sidebar-tags-section">
        <div className="sidebar-tag-header">
          <div className="sidebar-label">標籤</div>
          {selectedTags.length > 0 && (
            <button className="clear-tags-btn" onClick={onClearTags} title="清除所有標籤選擇">
              清除 ({selectedTags.length})
            </button>
          )}
        </div>

        <input
          className="tag-search-input"
          placeholder="過濾標籤..."
          value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}
        />

        <div className="tag-list">
          {favTags.map((tag) => {
            const isSelected = selectedTags.includes(tag)
            return (
              <button key={tag} className={`tag-btn ${isSelected ? 'active' : ''}`} onClick={() => onTagToggle(tag)}>
                {isSelected && <span className="tag-check">✓ </span>}
                <span className="tag-name">{tag}</span>
                <span className="tag-fav pinned" title="取消最愛" onClick={(e) => { e.stopPropagation(); onFavoriteTagToggle(tag) }}>★</span>
              </button>
            )
          })}
          {favTags.length > 0 && nonFavTags.length > 0 && (
            <div className="tag-divider" />
          )}
          {nonFavTags.map((tag) => {
            const isSelected = selectedTags.includes(tag)
            return (
              <button key={tag} className={`tag-btn ${isSelected ? 'active' : ''}`} onClick={() => onTagToggle(tag)}>
                {isSelected && <span className="tag-check">✓ </span>}
                <span className="tag-name">{tag}</span>
                <span className="tag-fav" title="設為最愛" onClick={(e) => { e.stopPropagation(); onFavoriteTagToggle(tag) }}>★</span>
              </button>
            )
          })}
          {favTags.length === 0 && nonFavTags.length === 0 && tagSearch && (
            <div style={{ fontSize: 11, color: 'var(--text2)', padding: '4px 8px' }}>
              無符合的標籤
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
