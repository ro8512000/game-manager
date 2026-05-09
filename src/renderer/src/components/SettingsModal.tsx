import { useState, useEffect } from 'react'
import type { Settings, DataLocationInfo } from '../electron.d'

interface Props {
  settings: Settings
  onSave: (settings: Settings) => Promise<void>
  onClose: () => void
}

export default function SettingsModal({ settings, onSave, onClose }: Props): React.JSX.Element {
  const [gamesDir, setGamesDir] = useState(settings.gamesDir || '')
  const [leProcPath, setLeProcPath] = useState(settings.leProcPath || '')
  const [locationInfo, setLocationInfo] = useState<DataLocationInfo | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrateProgress, setMigrateProgress] = useState<{ msg: string; pct: number } | null>(null)
  const [migrateError, setMigrateError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getDataLocationInfo().then(setLocationInfo)
  }, [])

  const handleSelectDir = async (): Promise<void> => {
    const path = await window.electronAPI.selectFolder()
    if (path) setGamesDir(path)
  }

  const handleSelectLe = async (): Promise<void> => {
    const path = await window.electronAPI.selectExe()
    if (path) setLeProcPath(path)
  }

  const handleSave = async (): Promise<void> => {
    await onSave({ gamesDir: gamesDir.trim() || null, leProcPath: leProcPath.trim() || null })
    onClose()
  }

  const handleMigrate = async (): Promise<void> => {
    if (!locationInfo || migrating) return
    setMigrating(true)
    setMigrateError(null)
    setMigrateProgress({ msg: '準備中...', pct: 0 })

    const unsub = window.electronAPI.onProgress((data) => {
      setMigrateProgress(data)
    })

    const result = await (locationInfo.isPortable
      ? window.electronAPI.migrateToAppData()
      : window.electronAPI.migrateToPortable())

    unsub()

    if (!result.success) {
      setMigrating(false)
      setMigrateProgress(null)
      setMigrateError(result.error ?? '搬移失敗')
    }
    // success: app.relaunch() fires in 1.5s — just leave the progress showing
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

          <div className="settings-section">
            <div className="settings-label">Locale Emulator</div>
            <div className="form-row">
              <input
                value={leProcPath}
                onChange={(e) => setLeProcPath(e.target.value)}
                placeholder="選擇 LEProc.exe 路徑..."
              />
              <button onClick={handleSelectLe}>選擇</button>
            </div>
            <div className="settings-hint">
              設定後，個別遊戲可選擇啟動語系，使用 Locale Emulator 開啟。
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">資料儲存位置</div>
            {!locationInfo ? (
              <div className="settings-hint">載入中...</div>
            ) : locationInfo.isDev ? (
              <div className="data-location-box">
                <div className="data-location-path">{locationInfo.currentRoot}</div>
                <div className="settings-hint">開發模式，資料位置由環境變數控制。</div>
              </div>
            ) : (
              <>
                <div className="data-location-box">
                  <span className={`mode-badge ${locationInfo.isPortable ? 'mode-portable' : 'mode-appdata'}`}>
                    {locationInfo.isPortable ? '攜帶式' : 'AppData'}
                  </span>
                  <div className="data-location-path">{locationInfo.currentRoot}</div>
                </div>
                {!migrating ? (
                  <>
                    <button className="migrate-btn" onClick={handleMigrate}>
                      {locationInfo.isPortable
                        ? `↩ 移回 AppData`
                        : `→ 搬移至程式資料夾 (${locationInfo.exeDir})`}
                    </button>
                    <div className="settings-hint">
                      {locationInfo.isPortable
                        ? '將設定與圖片搬回 AppData，並以 AppData 模式重新啟動。'
                        : '將設定與圖片複製到程式所在資料夾，搬移後可隨資料夾攜帶。'}
                    </div>
                  </>
                ) : (
                  <div className="progress-container">
                    <div className="progress-step-msg">{migrateProgress?.msg ?? '處理中...'}</div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${migrateProgress?.pct ?? 0}%` }}
                      />
                    </div>
                    <div className="progress-pct">{migrateProgress?.pct ?? 0}%</div>
                  </div>
                )}
                {migrateError && <div className="form-error">{migrateError}</div>}
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} disabled={migrating}>取消</button>
          <button className="primary" onClick={handleSave} disabled={migrating}>
            儲存
          </button>
        </div>
      </div>
    </div>
  )
}
