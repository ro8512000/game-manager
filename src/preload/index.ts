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
  extractCode: (str: string) => ipcRenderer.invoke('games:extractCode', str),
  launchGame: (args: { exePath: string; gameId: string }) => ipcRenderer.invoke('games:launch', args),
  openFolder: (folderPath: string) => ipcRenderer.invoke('games:openFolder', folderPath),
  deleteFolder: (folderPath: string) => ipcRenderer.invoke('games:deleteFolder', folderPath),
  selectFolder: () => ipcRenderer.invoke('games:selectFolder'),
  selectExe: () => ipcRenderer.invoke('games:selectExe'),
  selectExeFrom: (startPath: string) => ipcRenderer.invoke('games:selectExeFrom', startPath),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('games:scanFolder', folderPath),
  getImageData: (imgPath: string) => ipcRenderer.invoke('games:getImageData', imgPath),
  findExe: (folderPath: string) => ipcRenderer.invoke('games:findExe', folderPath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // File operations
  selectFile: () => ipcRenderer.invoke('games:selectFile'),
  previewMove: (args: unknown) => ipcRenderer.invoke('games:previewMove', args),
  previewExtract: (args: unknown) => ipcRenderer.invoke('games:previewExtract', args),
  moveToLibrary: (args: unknown) => ipcRenderer.invoke('games:moveToLibrary', args),
  extractArchive: (args: unknown) => ipcRenderer.invoke('games:extractArchive', args),

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
