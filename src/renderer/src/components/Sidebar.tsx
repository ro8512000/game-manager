import { useState, useMemo } from 'react'

interface Props {
  tags: string[]
  selectedTags: string[]
  filterRating: number
  favoritesOnly: boolean
  gameCount: number
  onTagToggle: (tag: string) => void
  onClearTags: () => void
  onRatingChange: (r: number) => void
  onFavoritesChange: (v: boolean) => void
}

export default function Sidebar({
  tags,
  selectedTags,
  filterRating,
  favoritesOnly,
  gameCount,
  onTagToggle,
  onClearTags,
  onRatingChange,
  onFavoritesChange
}: Props): React.JSX.Element {
  const [tagSearch, setTagSearch] = useState('')

  // Selected tags first, then alphabetical; filtered by tagSearch
  const sortedTags = useMemo(() => {
    const selected = selectedTags.filter((t) => tags.includes(t))
    const unselected = tags.filter((t) => !selectedTags.includes(t))
    const all = [...selected, ...unselected]
    return tagSearch
      ? all.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase()))
      : all
  }, [tags, selectedTags, tagSearch])

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
        <div className="sidebar-label">評分篩選</div>
        {[0, 1, 2, 3, 4, 5].map((r) => (
          <button
            key={r}
            className={`filter-btn ${filterRating === r ? 'active' : ''}`}
            onClick={() => onRatingChange(r)}
          >
            {r === 0 ? '全部' : '★'.repeat(r) + '☆'.repeat(5 - r) + ' 以上'}
          </button>
        ))}
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
          {sortedTags.map((tag) => {
            const isSelected = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                className={`tag-btn ${isSelected ? 'active' : ''}`}
                onClick={() => onTagToggle(tag)}
              >
                {isSelected && <span className="tag-check">✓ </span>}
                {tag}
              </button>
            )
          })}
          {sortedTags.length === 0 && tagSearch && (
            <div style={{ fontSize: 11, color: 'var(--text2)', padding: '4px 8px' }}>
              無符合的標籤
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
