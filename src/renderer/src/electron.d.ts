import type { GamesData, Game } from './types'

export interface Settings {
  gamesDir: string | null
  leProcPath: string | null
  fetchDescriptionOnFetch: boolean
  sakuraApiUrl: string | null
  translationTargetLang: string
  autoTranslateOnFetch: boolean
}

export interface PreviewMoveResult {
  willMove: boolean
  srcFolder?: string
  destFolder?: string
  relExePath?: string
  code?: string
}

export interface PreviewExtractResult {
  detectedCode: string | null
  destFolder: string
  method: 'filename' | 'archive' | 'name'
}

export interface DataLocationInfo {
  isDev: boolean
  isPortable: boolean
  currentRoot: string
  exeDir: string | null
  appDataDir: string | null
}

export interface MoveResult {
  success: boolean
  moved?: boolean
  exePath?: string
  folderPath?: string
  error?: string
}

export interface ExtractResult {
  success: boolean
  extractDir?: string
  detectedCode?: string | null
  error?: string
}

interface ElectronAPI {
  // Settings
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<boolean>

  // Games data
  loadGames: () => Promise<GamesData>
  saveGames: (data: GamesData) => Promise<boolean>
  fetchInfo: (code: string) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  suggestFetchDlsite: (term: string) => Promise<{ success: boolean; id?: string; data?: Record<string, unknown>; error?: string }>
  fetchGetchuInfo: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  fetchSteamInfo: (appId: string) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  extractCode: (str: string) => Promise<string | null>
  launchGame: (args: { exePath: string; gameId: string; locale?: string | null }) => Promise<boolean>
  openFolder: (folderPath: string) => Promise<boolean>
  selectFolder: () => Promise<string | null>
  selectExe: () => Promise<string | null>
  selectExeFrom: (startPath: string) => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
  getImageData: (imgPath: string) => Promise<string | null>
  uploadImage: (gameId: string, role: 'cover' | 'sample' | 'listImage') => Promise<string | null>
  findExe: (folderPath: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  openGetchuSearch: (keyword: string) => Promise<void>
  deleteFolder: (folderPath: string) => Promise<boolean>
  deleteFile: (filePath: string) => Promise<boolean>
  getFolderSize: (folderPath: string) => Promise<number | null>
  loadDescription: (gameId: string) => Promise<string>
  saveDescription: (gameId: string, text: string) => Promise<boolean>
  fetchDLsiteDescription: (code: string) => Promise<{ success: boolean; description?: string; error?: string }>
  loadTranslatedDescription: (gameId: string) => Promise<string>
  translateDescription: (gameId: string) => Promise<{ success: boolean; description?: string; error?: string }>
  selectImportDb: () => Promise<string | null>
  importPreview: (dbPath: string) => Promise<{ success: boolean; count?: number; error?: string }>
  importRun: (args: { dbPath: string; skipDuplicates: boolean; existingIds: string[] }) => Promise<{ success: boolean; imported: Record<string, unknown>[]; skipped: number; errors: string[]; error?: string }>
  getDataLocationInfo: () => Promise<DataLocationInfo>
  migrateToPortable: () => Promise<{ success: boolean; error?: string }>
  migrateToAppData: () => Promise<{ success: boolean; error?: string }>
  loadUiSettings: () => Promise<Record<string, unknown>>
  saveUiSettings: (patch: Record<string, unknown>) => Promise<boolean>
  onProgress: (callback: (data: { msg: string; pct: number }) => void) => () => void
  onGameSessionEnd: (callback: (data: { gameId: string; elapsed: number }) => void) => () => void

  // File operations (code auto-detected by main process)
  selectFile: () => Promise<{ path: string; type: 'exe' | 'archive'; code: string | null } | null>
  previewMove: (args: { exePath: string; gamesDir: string }) => Promise<PreviewMoveResult>
  previewExtract: (args: { archivePath: string; gamesDir: string }) => Promise<PreviewExtractResult>
  moveFolderToLibrary: (args: { srcFolder: string; gamesDir: string }) => Promise<{ success: boolean; newFolderPath?: string; error?: string }>
  moveToLibrary: (args: { exePath: string; gamesDir: string }) => Promise<MoveResult>
  extractArchive: (args: { archivePath: string; gamesDir: string }) => Promise<ExtractResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type { GamesData, Game }
