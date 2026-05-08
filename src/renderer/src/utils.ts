export function generateUUID(): string {
  return crypto.randomUUID()
}

export function localDateTime(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

import type { Game } from './types'

export function getGameSortValue(game: Game, key: string): string | number | null {
  switch (key) {
    case 'id':           return game.id
    case 'title':        return game.title || game.id
    case 'circle':       return game.circle
    case 'workType':     return game.workType ?? null
    case 'tags':         return game.tags.join(', ')
    case 'dlsiteRating': return game.dlsiteRating ? parseFloat(game.dlsiteRating) : null
    case 'rating':       return game.rating
    case 'releaseDate':  return game.releaseDate ?? null
    case 'addedAt':      return game.addedAt
    case 'lastPlayedAt': return game.lastPlayedAt ?? null
    case 'playCount':    return game.playCount ?? 0
    case 'playTime':     return game.playTime ?? 0
    case 'folderSize':   return game.folderSize ?? null
    default: return null
  }
}

export function formatPlayTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 分鐘'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  const remainMins = minutes % 60
  return remainMins === 0 ? `${hours} 小時` : `${hours} 小時 ${remainMins} 分鐘`
}
