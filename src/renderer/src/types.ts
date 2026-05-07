export interface Game {
  uuid: string  // unique per entry (auto-generated, never changes)
  id: string    // game code (RJ/VJ/BJ etc.), can have duplicates
  title: string
  circle: string
  tags: string[]
  cover: string | null
  coverUrl: string | null
  sampleImages: string[]
  path: string | null
  exe: string | null
  rating: number
  note: string
  addedAt: string
  language: string
  releaseDate: string | null
  workType: string | null
  dlsiteRating: string | null
  lastPlayedAt: string | null
  playCount: number
  playTime: number
  isFavorite: boolean
}

export type ViewMode = 'grid' | 'list'

export interface GamesData {
  games: Game[]
}

export interface ColumnDef {
  key: string
  label: string
  width: string
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'id',           label: '代碼',        width: '90px'  },
  { key: 'title',        label: '標題',        width: '1fr'   },
  { key: 'circle',       label: '社團',        width: '130px' },
  { key: 'workType',     label: '作品形式',    width: '100px' },
  { key: 'tags',         label: '標籤',        width: '180px' },
  { key: 'dlsiteRating', label: 'DLsite 評分', width: '90px'  },
  { key: 'rating',       label: '個人評分',    width: '80px'  },
  { key: 'releaseDate',  label: '發售日',      width: '100px' },
  { key: 'addedAt',      label: '加入時間',    width: '100px' },
  { key: 'lastPlayedAt', label: '上次遊玩',    width: '130px' },
  { key: 'playCount',    label: '遊玩次數',    width: '70px'  },
  { key: 'playTime',     label: '遊玩時間',    width: '100px' },
]

export const DEFAULT_COLUMNS = ['id', 'title', 'circle', 'tags', 'rating']
