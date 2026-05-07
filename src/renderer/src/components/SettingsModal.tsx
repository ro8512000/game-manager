import { useState } from 'react'
import type { Settings } from '../electron.d'

interface Props {
  settings: Settings
  onSave: (settings: Settings) => Promise<void>
  onClose: () => void
}

export default function SettingsModal({ settings, onSave, onClose }: Props): React.JSX.Element {
  const [gamesDir, setGamesDir] = useState(settings.gamesDir || '')

  const handleSelectDir = async (): Promise<void> => {
    const path = await window.electronAPI.selectFolder()
    if (path) setGamesDir(path)
  }

  const handleSave = async (): Promise<void> => {
    await onSave({ gamesDir: gamesDir.trim() || null })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>設定</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-label">遊戲儲存目錄</div>
            <div className="form-row">
              <input
                value={gamesDir}
                onChange={(e) => setGamesDir(e.target.value)}
                placeholder="選擇遊戲儲存位置..."
              />
              <button onClick={handleSelectDir}>選擇資料夾</button>
            </div>
            <div className="settings-hint">
              新增遊戲時，遊戲資料夾會被移動或解壓縮到此目錄。
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={handleSave}>
            儲存
          </button>
        </div>
      </div>
    </div>
  )
}
