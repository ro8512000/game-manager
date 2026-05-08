import { useState } from 'react'
import type { Game } from '../types'

interface Props {
  existingIds: string[]
  onImport: (games: Game[]) => Promise<void>
  onClose: () => void
}

type Step = 'select' | 'preview' | 'running' | 'done'

export default function ImportModal({ existingIds, onImport, onClose }: Props): React.JSX.Element {
  const [step, setStep] = useState<Step>('select')
  const [dbPath, setDbPath] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState(0)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [error, setError] = useState('')

  const handleSelectDb = async (): Promise<void> => {
    const path = await window.electronAPI.selectImportDb()
    if (!path) return
    setDbPath(path)
    setError('')
    const preview = await window.electronAPI.importPreview(path)
    if (!preview.success) { setError(preview.error ?? '讀取失敗'); return }
    setPreviewCount(preview.count ?? 0)
    setStep('preview')
  }

  const handleImport = async (): Promise<void> => {
    if (!dbPath) return
    setStep('running')
    const res = await window.electronAPI.importRun({ dbPath, skipDuplicates, existingIds })
    if (!res.success) { setError(res.error ?? '匯入失敗'); setStep('preview'); return }
    await onImport(res.imported as unknown as Game[])
    setResult({ imported: res.imported.length, skipped: res.skipped, errors: res.errors })
    setStep('done')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>匯入 GameManager 舊版資料</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {step === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                請選擇 GameManager 0.49 的 <strong>Games.db</strong> 檔案。<br />
                圖片將從同目錄下的 <code>Images/</code> 資料夾自動複製至新版。
              </div>
              <button className="primary" onClick={handleSelectDb}>選擇 Games.db</button>
            </div>
          )}

          {step === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="import-stat-row">
                <span>資料庫路徑</span>
                <span style={{ color: 'var(--text2)', fontSize: 11, wordBreak: 'break-all' }}>{dbPath}</span>
              </div>
              <div className="import-stat-row">
                <span>找到遊戲</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{previewCount} 筆</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                跳過已存在於遊戲庫的相同代碼（目前庫有 {existingIds.length} 筆）
              </label>
              <div style={{ color: 'var(--text2)', fontSize: 12 }}>
                匯入的欄位：代碼、標題、社團、標籤、備注、評分、遊玩紀錄、路徑、圖片、大小等。<br />
                遊戲目錄不會搬移，圖片會複製一份到新版的 game-images/ 目錄。
              </div>
            </div>
          )}

          {step === 'running' && (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text2)' }}>
              匯入中，請稍候...
            </div>
          )}

          {step === 'done' && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="import-stat-row">
                <span>成功匯入</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{result.imported} 筆</span>
              </div>
              <div className="import-stat-row">
                <span>跳過重複</span>
                <span>{result.skipped} 筆</span>
              </div>
              {result.errors.length > 0 && (
                <div className="import-stat-row">
                  <span>錯誤</span>
                  <span style={{ color: 'var(--danger)' }}>{result.errors.length} 筆</span>
                </div>
              )}
              <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 8 }}>匯入完成！</div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>{step === 'done' ? '關閉' : '取消'}</button>
          {step === 'preview' && (
            <>
              <button onClick={handleSelectDb}>重新選擇</button>
              <button className="primary" onClick={handleImport} disabled={previewCount === 0}>
                開始匯入
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
