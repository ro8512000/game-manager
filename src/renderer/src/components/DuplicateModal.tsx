import { useState } from 'react'
import type { Game } from '../types'

interface Props {
  duplicates: Map<string, Game[]>
  onDelete: (uuids: string[]) => void
  onClose: () => void
}

export default function DuplicateModal({ duplicates, onDelete, onClose }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (uuid: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(uuid) ? next.delete(uuid) : next.add(uuid)
      return next
    })
  }

  const handleDelete = (): void => {
    if (selected.size === 0) return
    onDelete(Array.from(selected))
    // Remove deleted from selection
    setSelected(new Set())
  }

  const groups = Array.from(duplicates.entries()).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>重複遊戲偵測</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          {groups.length === 0 ? (
            <div style={{ color: 'var(--text2)', textAlign: 'center', padding: '24px' }}>
              沒有發現重複的遊戲代碼
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
                發現 {groups.length} 個代碼有重複，共 {Array.from(duplicates.values()).reduce((s, g) => s + g.length, 0)} 筆。勾選要移除的條目：
              </div>
              {groups.map(([id, games]) => (
                <div key={id} className="dup-group">
                  <div className="dup-group-header">{id} ({games.length} 筆)</div>
                  {games.map((g) => (
                    <label key={g.uuid} className="dup-item">
                      <input
                        type="checkbox"
                        checked={selected.has(g.uuid)}
                        onChange={() => toggle(g.uuid)}
                      />
                      <div className="dup-item-info">
                        <div className="dup-item-title">{g.title || g.id}</div>
                        <div className="dup-item-meta">
                          加入：{g.addedAt}
                          {g.path ? ` ｜ ${g.path}` : ' ｜ 無路徑'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>關閉</button>
          {selected.size > 0 && (
            <button className="btn-delete" onClick={handleDelete}>
              移除選取 ({selected.size} 筆)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
