export interface ElectronAPI {
  loadGames: () => Promise<{ games: Game[] }>
  saveGames: (data: { games: Game[] }) => Promise<boolean>
  fetchInfo: (code: string) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  extractCode: (str: string) => Promise<string | null>
  launchGame: (exePath: string) => Promise<boolean>
  openFolder: (folderPath: string) => Promise<boolean>
  selectFolder: () => Promise<string | null>
  selectExe: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: ScanItem[]; error?: string }>
  getImageData: (imgPath: string) => Promise<string | null>
}

interface Game {
  id: string
  title: string
  circle: string
  tags: string[]
  cover: string | null
  coverUrl: string | null
  path: string | null
  exe: string | null
  rating: number
  note: string
  addedAt: string
  language: string
}

interface ScanItem {
  code: string
  name: string
  path: string
  isDir: boolean
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
