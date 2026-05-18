import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),

  // Games data
  loadGames: () => ipcRenderer.invoke('games:load'),
  saveGames: (data: unknown) => ipcRenderer.invoke('games:save', data),
  fetchInfo: (code: string) => ipcRenderer.invoke('games:fetchInfo', code),
  suggestFetchDlsite: (term: string) => ipcRenderer.invoke('games:suggestFetchDlsite', term),
  fetchGetchuInfo: (id: string) => ipcRenderer.invoke('games:fetchGetchuInfo', id),
  fetchSteamInfo: (appId: string) => ipcRenderer.invoke('games:fetchSteamInfo', appId),
  extractCode: (str: string) => ipcRenderer.invoke('games:extractCode', str),
  launchGame: (args: { exePath: string; gameId: string; locale?: string | null }) => ipcRenderer.invoke('games:launch', args),
  openFolder: (folderPath: string) => ipcRenderer.invoke('games:openFolder', folderPath),
  deleteFolder: (folderPath: string) => ipcRenderer.invoke('games:deleteFolder', folderPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('games:deleteFile', filePath),
  getFolderSize: (folderPath: string) => ipcRenderer.invoke('games:getFolderSize', folderPath),
  selectFolder: () => ipcRenderer.invoke('games:selectFolder'),
  selectExe: () => ipcRenderer.invoke('games:selectExe'),
  selectExeFrom: (startPath: string) => ipcRenderer.invoke('games:selectExeFrom', startPath),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('games:scanFolder', folderPath),
  getImageData: (imgPath: string) => ipcRenderer.invoke('games:getImageData', imgPath),
  uploadImage: (gameId: string, role: 'cover' | 'sample' | 'listImage') => ipcRenderer.invoke('games:uploadImage', { gameId, role }),
  findExe: (folderPath: string) => ipcRenderer.invoke('games:findExe', folderPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openGetchuSearch: (keyword: string) => ipcRenderer.invoke('shell:openGetchuSearch', keyword),

  // File operations
  selectFile: () => ipcRenderer.invoke('games:selectFile'),
  previewMove: (args: unknown) => ipcRenderer.invoke('games:previewMove', args),
  previewExtract: (args: unknown) => ipcRenderer.invoke('games:previewExtract', args),
  moveFolderToLibrary: (args: { srcFolder: string; gamesDir: string }) => ipcRenderer.invoke('games:moveFolderToLibrary', args),
  moveToLibrary: (args: unknown) => ipcRenderer.invoke('games:moveToLibrary', args),
  extractArchive: (args: unknown) => ipcRenderer.invoke('games:extractArchive', args),

  loadDescription: (gameId: string) => ipcRenderer.invoke('games:loadDescription', gameId),
  saveDescription: (gameId: string, text: string) => ipcRenderer.invoke('games:saveDescription', { gameId, text }),
  fetchDLsiteDescription: (code: string) => ipcRenderer.invoke('games:fetchDLsiteDescription', code),
  loadTranslatedDescription: (gameId: string) => ipcRenderer.invoke('games:loadTranslatedDescription', gameId),
  translateDescription: (gameId: string) => ipcRenderer.invoke('games:translateDescription', gameId),

  // Import from old version
  selectImportDb: () => ipcRenderer.invoke('import:selectDb'),
  importPreview: (dbPath: string) => ipcRenderer.invoke('import:preview', dbPath),
  importRun: (args: unknown) => ipcRenderer.invoke('import:run', args),

  // Data location & migration
  getDataLocationInfo: () => ipcRenderer.invoke('data:getLocationInfo'),
  migrateToPortable: () => ipcRenderer.invoke('data:migrateToPortable'),
  migrateToAppData: () => ipcRenderer.invoke('data:migrateToAppData'),

  // UI settings (file-based, survives dev port changes)
  loadUiSettings: () => ipcRenderer.invoke('ui:load'),
  saveUiSettings: (patch: unknown) => ipcRenderer.invoke('ui:save', patch),

  // Events from main process
  onProgress: (callback: (data: { msg: string; pct: number }) => void) => {
    const handler = (_: IpcRendererEvent, data: { msg: string; pct: number }): void => callback(data)
    ipcRenderer.on('progress:step', handler)
    return (): void => { ipcRenderer.removeListener('progress:step', handler) }
  },
  onGameSessionEnd: (callback: (data: { gameId: string; elapsed: number }) => void) => {
    const handler = (_: IpcRendererEvent, data: { gameId: string; elapsed: number }) => callback(data)
    ipcRenderer.on('game:session-end', handler)
    return () => ipcRenderer.removeListener('game:session-end', handler)
  }
})
