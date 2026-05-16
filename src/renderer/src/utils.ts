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

export function findDuplicates(games: Game[]): Map<string, Game[]> {
  const groups = new Map<string, Game[]>()
  for (const g of games) {
    const existing = groups.get(g.id) ?? []
    existing.push(g)
    groups.set(g.id, existing)
  }
  for (const [id, group] of groups) {
    if (group.length < 2) groups.delete(id)
  }
  return groups
}

export function getGroupValue(game: Game, groupBy: string): string {
  switch (groupBy) {
    case 'circle':      return game.circle || '（無社團）'
    case 'rating':      return game.rating ? '★'.repeat(game.rating) : '未評分'
    case 'workType':    return game.workType || '（無作品形式）'
    case 'source': {
      if (/^[RVB]J\d{6,8}$/i.test(game.id)) return 'DLsite'
      if (/^ST\d+$/i.test(game.id)) return 'Steam'
      return '其他'
    }
    case 'releaseYear': {
      const year = game.releaseDate?.match(/(\d{4})/)?.[1]
      return year ?? '未知年份'
    }
    case 'addedAtMonth': {
      const m = game.addedAt?.match(/^(\d{4})-(\d{2})/)
      return m ? `${m[1]}年${m[2]}月` : '未知'
    }
    case 'releaseDateMonth': {
      const m = game.releaseDate?.match(/(\d{4})[年\/\-](\d{1,2})/)
      return m ? `${m[1]}年${String(m[2]).padStart(2, '0')}月` : '未知日期'
    }
    case 'lastPlayedAtMonth': {
      if (!game.lastPlayedAt) return '從未遊玩'
      const m = game.lastPlayedAt.match(/^(\d{4})-(\d{2})/)
      return m ? `${m[1]}年${m[2]}月` : '未知'
    }
    default: return ''
  }
}

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

const UNKNOWN_GROUPS = new Set(['未知', '未知日期', '未知年份', '未知月份', '從未遊玩'])

export function compareGroups(ga: string, gb: string, dir: 'asc' | 'desc'): number {
  const aUnknown = UNKNOWN_GROUPS.has(ga)
  const bUnknown = UNKNOWN_GROUPS.has(gb)
  if (aUnknown && bUnknown) return 0
  if (aUnknown) return 1
  if (bUnknown) return -1
  const cmp = ga.localeCompare(gb, 'ja')
  return dir === 'desc' ? -cmp : cmp
}

export function sortListGames(
  games: Game[],
  sortKey: string | null,
  sortDir: 'asc' | 'desc' | null,
  groupBy: string | null
): Game[] {
  const list = [...games]
  const dir = sortDir ?? 'asc'
  if (groupBy) {
    list.sort((a, b) => compareGroups(getGroupValue(a, groupBy), getGroupValue(b, groupBy), dir))
  }
  if (sortKey && sortDir) {
    list.sort((a, b) => {
      if (groupBy) {
        const ga = getGroupValue(a, groupBy)
        const gb = getGroupValue(b, groupBy)
        const groupCmp = compareGroups(ga, gb, dir)
        if (groupCmp !== 0) return groupCmp
      }
      const va = getGameSortValue(a, sortKey)
      const vb = getGameSortValue(b, sortKey)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const result = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'ja')
      return sortDir === 'asc' ? result : -result
    })
  }
  return list
}
