process.stdout.write('')
import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join, basename, extname, relative, parse as parsePath, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  createWriteStream,
  copyFileSync
} from 'fs'
import { rename, rm } from 'fs/promises'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { path7za } = require('7zip-bin') as { path7za: string }
const execFileAsync = promisify(execFile)

const appRoot = app.isPackaged ? app.getPath('userData') : app.getAppPath()
const dataDir = join(appRoot, 'data')
const gamesFile = join(dataDir, 'games.json')
const settingsFile = join(dataDir, 'settings.json')
const uiSettingsFile = join(dataDir, 'ui-settings.json')
const gameImagesDir = join(appRoot, 'game-images')
const logDir = join(appRoot, 'logs')

interface Settings {
  gamesDir: string | null
}

function cleanOldLogs(): void {
  if (!existsSync(logDir)) return
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000
  for (const file of readdirSync(logDir)) {
    if (!file.endsWith('.log')) continue
    try {
      if (statSync(join(logDir, file)).mtimeMs < cutoff) unlinkSync(join(logDir, file))
    } catch { /* skip */ }
  }
}

function logError(context: string, err: unknown): void {
  try {
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const time = now.toISOString().slice(11, 19)
    appendFileSync(join(logDir, `${date}.log`), `[${date} ${time}] [${context}] ${String(err)}\n`, 'utf-8')
  } catch { /* never crash on logging */ }
}

function loadUiSettings(): Record<string, unknown> {
  if (!existsSync(uiSettingsFile)) return {}
  try { return JSON.parse(readFileSync(uiSettingsFile, 'utf-8')) } catch { return {} }
}

function saveUiSettings(patch: Record<string, unknown>): void {
  const current = loadUiSettings()
  writeFileSync(uiSettingsFile, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8')
}

function ensureDirs(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  if (!existsSync(gameImagesDir)) mkdirSync(gameImagesDir, { recursive: true })
  cleanOldLogs()
}

function loadSettings(): Settings {
  if (!existsSync(settingsFile)) return { gamesDir: null }
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf-8'))
  } catch {
    return { gamesDir: null }
  }
}

// Strip absolute prefix and return path relative to gameImagesDir (e.g. "RJ01234/main.jpg")
function toRelativeImagePath(p: string): string {
  if (!p) return p
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/game-images/')
  if (idx !== -1) return normalized.slice(idx + '/game-images/'.length)
  // Already relative (no drive letter, no leading slash)
  if (!normalized.match(/^[A-Za-z]:/) && !normalized.startsWith('/')) return p
  return basename(p)
}

// Resolve a stored path (relative or stale absolute) to absolute using current gameImagesDir
function toAbsoluteImagePath(p: string): string {
  if (!p) return p
  const normalized = p.replace(/\\/g, '/')
  // Stale absolute path containing game-images anywhere in it → extract relative part
  const idx = normalized.lastIndexOf('/game-images/')
  if (idx !== -1) return join(gameImagesDir, normalized.slice(idx + '/game-images/'.length))
  // Already relative
  if (!normalized.match(/^[A-Za-z]:/) && !normalized.startsWith('/')) return join(gameImagesDir, p)
  return p
}

// Extract first RJ/VJ/BJ code found anywhere in the file path
function extractCodeFromPath(filePath: string): string | null {
  const parts = filePath.replace(/\\/g, '/').split('/')
  for (const part of [...parts].reverse()) {
    const match = part.match(/([RVB]J\d{6,8})/i)
    if (match) return match[1].toUpperCase()
  }
  return null
}

// Walk up directory tree; return first ancestor folder whose name contains an RJ code
function findRJAncestorFromPath(filePath: string): { ancestor: string; code: string } | null {
  let current = dirname(filePath)
  const root = parsePath(filePath).root
  while (current !== root && current.length > root.length) {
    const name = basename(current)
    const match = name.match(/([RVB]J\d{6,8})/i)
    if (match) return { ancestor: current, code: match[1].toUpperCase() }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

// Recursively sum file sizes in a directory
function getDirSize(dirPath: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      try {
        const full = join(dirPath, entry.name)
        if (entry.isDirectory()) total += getDirSize(full)
        else if (entry.isFile()) total += statSync(full).size
      } catch { /* skip permission errors */ }
    }
  } catch { /* skip */ }
  return total
}

// Recursive directory copy using copyFileSync (handles Unicode paths correctly on Windows)
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else if (entry.isFile()) copyFileSync(s, d)
  }
}

// Move a directory; falls back to manual copy+delete for cross-drive moves
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      copyDirSync(src, dest)
      await rm(src, { recursive: true, force: true })
    } else {
      throw e
    }
  }
}

// List top-level entries in an archive and return the first RJ code found
async function findRJCodeInArchive(archivePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(path7za, ['l', archivePath, '-slt', '-y'])
    const pathLines = stdout.match(/^Path = (.+)$/gm) || []
    const topDirs = new Set<string>()
    for (const line of pathLines.slice(1)) {
      topDirs.add(line.replace('Path = ', '').trim().split(/[/\\]/)[0])
    }
    for (const dir of topDirs) {
      const match = dir.match(/([RVB]J\d{6,8})/i)
      if (match) return match[1].toUpperCase()
    }
    return null
  } catch {
    return null
  }
}

// Extract archive using 7-Zip into outputDir
// -mcp=932 tells 7-zip to treat non-UTF8 filenames as Shift-JIS (Japanese ZIP standard)
async function extract7z(archivePath: string, outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })
  await execFileAsync(path7za, ['x', archivePath, `-o${outputDir}`, '-y', '-mcp=932'])
}

function fetchHTML(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'))
    const options = {
      headers: {
        Cookie: 'locale=ja_JP',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }
    httpsGet(url, options, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location = res.headers.location
        res.resume()
        if (!location) return reject(new Error('Redirect without location'))
        const next = location.startsWith('http') ? location : new URL(location, url).toString()
        fetchHTML(next, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      let html = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => (html += chunk))
      res.on('end', () => resolve(html))
    }).on('error', reject)
  })
}

function downloadImage(url: string, dest: string, redirectCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'))
    const imageUrl = url.startsWith('//') ? `https:${url}` : url
    httpsGet(imageUrl, { headers: { Cookie: 'locale=zh_TW' } }, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location = res.headers.location
        res.resume()
        if (!location) return reject(new Error('Redirect without location'))
        const next = location.startsWith('http') ? location : new URL(location, imageUrl).toString()
        downloadImage(next, dest, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      const file = createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', (e) => { file.close(); reject(e) })
    }).on('error', reject)
  })
}

function getWorkURL(code: string): string {
  if (code.startsWith('VJ')) return `https://www.dlsite.com/home/work/=/product_id/${code}.html`
  if (code.startsWith('BJ')) return `https://www.dlsite.com/boys-love/work/=/product_id/${code}.html`
  return `https://www.dlsite.com/maniax/work/=/product_id/${code}.html`
}

async function fetchDLsiteInfo(
  code: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const url = getWorkURL(code)
    const html = await fetchHTML(url)

    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)
    let title = titleMatch ? titleMatch[1] : code
    title = title.replace(/\s*[|｜]\s*DLsite.*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()

    const coverMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)
    const coverUrl = coverMatch ? coverMatch[1] : null

    const circleMatch = html.match(/class="maker_name"[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/)
    const circle = circleMatch ? circleMatch[1].trim() : ''

    // ── Tags (ジャンル) ──────────────────────────────────────────────────────
    const tags: string[] = []
    // Method 1: table row with ジャンル header
    const genreRowMatch = html.match(/<th[^>]*>\s*ジャンル\s*<\/th>\s*<td[^>]*>([\s\S]{0,3000}?)<\/td>/)
    if (genreRowMatch) {
      for (const m of genreRowMatch[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
        const tag = m[1].trim()
        if (tag && tag.length < 50) tags.push(tag)
      }
    }
    // Method 2: work_genre / main_genre class (fallback)
    if (tags.length === 0) {
      for (const m of html.matchAll(/class="(?:work_genre|main_genre)"[^>]*>([\s\S]{0,2000}?)<\/(?:div|ul)>/g)) {
        for (const a of m[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
          const tag = a[1].trim()
          if (tag && tag.length < 50) tags.push(tag)
        }
      }
    }

    // ── Work type (作品形式) ──────────────────────────────────────────────
    let workType: string | null = null
    {
      // Extract work_outline table; fall back to full page
      const outlineSection = html.match(/<(?:table|tbody)[^>]*id="work_outline"[^>]*>([\s\S]{0,20000}?)<\/(?:table|tbody)>/)
      const searchIn = outlineSection ? outlineSection[1] : html
      // Split into <tr> blocks and find the one containing 作品形式
      for (const row of searchIn.split(/<\/tr>/i)) {
        if (/作品形式/.test(row)) {
          const links: string[] = []
          for (const m of row.matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
            const t = m[1].trim()
            if (t && t.length < 30) links.push(t)
          }
          if (links.length > 0) { workType = links.join(' / '); break }
        }
      }
    }

    // ── DLsite community rating ──────────────────────────────────────────
    const dlsiteRatingMatch =
      html.match(/"ratingValue"\s*:\s*"([0-9.]+)"/) ||
      html.match(/class="[^"]*count_average[^"]*"[^>]*>\s*([0-9.]+)\s*</) ||
      html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/)
    const dlsiteRating = dlsiteRatingMatch ? dlsiteRatingMatch[1].trim() : null

    // ── Release date (販売日) ────────────────────────────────────────────
    let releaseDate: string | null = null
    const releaseDateRow = html.match(/<th[^>]*>\s*販売日\s*<\/th>\s*<td[^>]*>([\s\S]{0,300}?)<\/td>/)
    if (releaseDateRow) {
      releaseDate = releaseDateRow[1].replace(/<[^>]+>/g, '').trim() || null
    }
    if (!releaseDate) {
      const rdMatch =
        html.match(/itemprop="datePublished"[^>]*content="([^"]+)"/) ||
        html.match(/(\d{4}年\d{1,2}月\d{1,2}日)/)
      releaseDate = rdMatch ? rdMatch[1].trim() : null
    }

    // Collect all sample image URLs (deduplicated, preserving order)
    const smpUrlMap = new Map<string, string>() // smpKey → full URL
    for (const m of html.matchAll(/((?:https?:)?\/\/img\.dlsite\.jp[^"'\s<>]+_img_(smp\d+)\.[a-z]+)/gi)) {
      const smpKey = m[2].toLowerCase()
      if (!smpUrlMap.has(smpKey)) smpUrlMap.set(smpKey, m[1])
    }

    // Per-game image subdirectory: game-images/{code}/
    const codeImagesDir = join(gameImagesDir, code)
    mkdirSync(codeImagesDir, { recursive: true })

    const totalImgs = (coverUrl ? 1 : 0) + smpUrlMap.size
    let imgDone = 0

    // Download main cover
    let localCover: string | null = null
    if (coverUrl) {
      mainWindow?.webContents.send('progress:step', { msg: `下載圖片 ${imgDone + 1}/${totalImgs}`, pct: Math.round((imgDone / Math.max(totalImgs, 1)) * 100) })
      const mainExt = extname(coverUrl) || '.jpg'
      const imgPath = join(codeImagesDir, `main${mainExt}`)
      try {
        await downloadImage(coverUrl, imgPath)
        localCover = imgPath
      } catch { /* ignore */ }
      imgDone++
    }

    // Download all sample images
    const localSamples: string[] = []
    for (const [smpKey, smpUrl] of smpUrlMap) {
      mainWindow?.webContents.send('progress:step', { msg: `下載圖片 ${imgDone + 1}/${totalImgs}`, pct: Math.round((imgDone / Math.max(totalImgs, 1)) * 100) })
      const smpExt = extname(smpUrl) || '.jpg'
      const imgPath = join(codeImagesDir, `${smpKey}${smpExt}`)
      try {
        await downloadImage(smpUrl, imgPath)
        localSamples.push(imgPath)
      } catch { /* ignore */ }
      imgDone++
    }
    if (totalImgs > 0) mainWindow?.webContents.send('progress:step', { msg: `✓ 圖片完成 (${imgDone} 張)`, pct: 100 })

    return { success: true, data: { title, circle, tags, coverUrl, localCover, releaseDate, workType, dlsiteRating, sampleImages: localSamples } }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  const saved = loadUiSettings()
  const savedW = typeof saved.windowWidth === 'number' && saved.windowWidth > 0 ? saved.windowWidth : null
  const savedH = typeof saved.windowHeight === 'number' && saved.windowHeight > 0 ? saved.windowHeight : null
  const winW = savedW ?? (sw > 100 ? Math.min(1280, sw) : 1280)
  const winH = savedH ?? (sh > 100 ? Math.min(800, sh) : 800)
  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  mainWindow.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (!mainWindow) return
      const [w, h] = mainWindow.getSize()
      saveUiSettings({ windowWidth: w, windowHeight: h })
    }, 500)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dlsite-manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ensureDirs()

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:load', () => loadSettings())

  ipcMain.handle('settings:save', (_, settings: Settings) => {
    try {
      ensureDirs()
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8')
      return true
    } catch {
      return false
    }
  })

  // ── Games data ────────────────────────────────────────────────────────────
  ipcMain.handle('games:load', () => {
    if (!existsSync(gamesFile)) return { games: [] }
    try {
      const raw = JSON.parse(readFileSync(gamesFile, 'utf-8'))
      raw.games = raw.games.map((g: Record<string, unknown>) => ({
        ...g,
        uuid: g.uuid ?? randomUUID(),
        lastPlayedAt: g.lastPlayedAt ?? null,
        playCount: g.playCount ?? 0,
        playTime: g.playTime ?? 0,
        releaseDate: g.releaseDate ?? null,
        workType: g.workType ?? null,
        dlsiteRating: g.dlsiteRating ?? null,
        sampleImages: ((g.sampleImages as string[]) ?? []).map(toAbsoluteImagePath),
        isFavorite: g.isFavorite ?? false,
        folderSize: g.folderSize ?? null,
        cover: g.cover ? toAbsoluteImagePath(g.cover as string) : null
      }))
      return raw
    } catch {
      return { games: [] }
    }
  })

  ipcMain.handle('games:save', (_, data) => {
    try {
      ensureDirs()
      const normalized = {
        ...data,
        games: data.games.map((g: Record<string, unknown>) => ({
          ...g,
          cover: g.cover ? toRelativeImagePath(g.cover as string) : null,
          sampleImages: ((g.sampleImages as string[]) ?? []).map(toRelativeImagePath)
        }))
      }
      writeFileSync(gamesFile, JSON.stringify(normalized, null, 2), 'utf-8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('games:fetchInfo', async (_, code: string) => {
    mainWindow?.webContents.send('progress:step', { msg: 'DLsite 資訊抓取中...', pct: 0 })
    const result = await fetchDLsiteInfo(code)
    mainWindow?.webContents.send('progress:step', { msg: result.success ? '✓ 資訊抓取完成' : '⚠ 無法取得資訊', pct: 100 })
    return result
  })

  ipcMain.handle('games:extractCode', (_, str: string) => {
    const match = str.match(/([RVB]J\d{6,8})/i)
    return match ? match[1].toUpperCase() : null
  })

  // Launch exe; track session duration and notify renderer on exit
  ipcMain.handle('games:launch', (_, { exePath, gameId }: { exePath: string; gameId: string }) => {
    try {
      const startTime = Date.now()
      const child = spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(exePath)
      })
      child.on('error', (e) => logError('games:launch', `gameId=${gameId} exe=${exePath} ${e}`))
      child.on('close', (code) => {
        if (code !== 0 && code !== null) logError('games:launch', `gameId=${gameId} exited with code ${code}`)
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        mainWindow?.webContents.send('game:session-end', { gameId, elapsed })
      })
      return true
    } catch (e) {
      logError('games:launch', `gameId=${gameId} exe=${exePath} ${e}`)
      return false
    }
  })

  // Find first game exe in a folder (depth-limited search, skips setup/install)
  ipcMain.handle('games:findExe', (_, folderPath: string): string | null => {
    const skipNames = ['setup', 'install', 'uninstall', 'uachelper', 'directx', 'vcredist', 'dotnet']
    function search(dir: string, depth: number): string | null {
      if (depth > 4) return null
      let items: string[]
      try { items = readdirSync(dir) } catch { return null }
      // Prefer common game exe names first
      for (const name of ['game.exe', 'app.exe', 'nw.exe', 'rpg_rt.exe']) {
        if (items.map(i => i.toLowerCase()).includes(name)) return join(dir, name)
      }
      // Any exe not in skip list
      for (const item of items) {
        const lower = item.toLowerCase()
        if (lower.endsWith('.exe') && !skipNames.some(s => lower.includes(s))) {
          return join(dir, item)
        }
      }
      // Recurse into subdirectories
      for (const item of items) {
        const fullPath = join(dir, item)
        try {
          if (statSync(fullPath).isDirectory()) {
            const found = search(fullPath, depth + 1)
            if (found) return found
          }
        } catch { /* skip */ }
      }
      return null
    }
    return search(folderPath, 0)
  })

  ipcMain.handle('games:openFolder', async (_, folderPath: string) => {
    try { await shell.openPath(folderPath); return true } catch { return false }
  })

  ipcMain.handle('games:deleteFolder', async (_, folderPath: string) => {
    try { await rm(folderPath, { recursive: true, force: true }); return true } catch { return false }
  })

  ipcMain.handle('games:getFolderSize', (_, folderPath: string): number | null => {
    if (!folderPath || !existsSync(folderPath)) return null
    try { return getDirSize(folderPath) } catch { return null }
  })

  ipcMain.handle('games:deleteFile', async (_, filePath: string) => {
    try { await rm(filePath, { force: true }); return true } catch (e) { logError('games:deleteFile', e); return false }
  })

  ipcMain.handle('shell:openExternal', (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('games:selectFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('games:selectExe', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // Open exe dialog starting from the given path (file or directory)
  ipcMain.handle('games:selectExeFrom', async (_, startPath: string) => {
    let defaultPath: string | undefined
    if (startPath) {
      try {
        defaultPath = statSync(startPath).isFile() ? dirname(startPath) : startPath
      } catch { defaultPath = undefined }
    }
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      defaultPath,
      filters: [
        { name: '執行檔', extensions: ['exe'] },
        { name: '全部檔案', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // Select exe or archive; auto-detect code from path
  ipcMain.handle('games:selectFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '遊戲檔案', extensions: ['exe', 'zip', '7z', 'rar', 'lzh', 'tar', 'gz', 'bz2'] }
      ]
    })
    if (r.canceled) return null
    const filePath = r.filePaths[0]
    const type: 'exe' | 'archive' = extname(filePath).toLowerCase() === '.exe' ? 'exe' : 'archive'
    const code = extractCodeFromPath(filePath)
    return { path: filePath, type, code }
  })

  // Preview: what moving this exe would do (auto-detects code from path)
  ipcMain.handle(
    'games:previewMove',
    (_, { exePath, gamesDir }: { exePath: string; gamesDir: string }) => {
      const found = findRJAncestorFromPath(exePath)
      const srcFolder = found ? found.ancestor : dirname(exePath)
      const destFolder = join(gamesDir, basename(srcFolder))
      const code = found?.code ?? null
      return { willMove: true, srcFolder, destFolder, code, relExePath: relative(srcFolder, exePath) }
    }
  )

  // Preview: extract to folder named after archive file
  ipcMain.handle(
    'games:previewExtract',
    async (_, { archivePath, gamesDir }: { archivePath: string; gamesDir: string }) => {
      const archiveName = basename(archivePath, extname(archivePath))
      let detectedCode = extractCodeFromPath(archivePath)
      if (!detectedCode) detectedCode = await findRJCodeInArchive(archivePath)
      return { detectedCode, destFolder: join(gamesDir, archiveName), method: 'name' as const }
    }
  )

  // Move game folder to library (uses RJ ancestor if found, otherwise parent folder of exe)
  ipcMain.handle(
    'games:moveToLibrary',
    async (_, { exePath, gamesDir }: { exePath: string; gamesDir: string }) => {
      try {
        const found = findRJAncestorFromPath(exePath)
        const srcFolder = found ? found.ancestor : dirname(exePath)
        const destFolder = join(gamesDir, basename(srcFolder))
        mkdirSync(gamesDir, { recursive: true })
        mainWindow?.webContents.send('progress:step', { msg: '正在移動遊戲資料...', pct: 0 })
        await moveDir(srcFolder, destFolder)
        mainWindow?.webContents.send('progress:step', { msg: '✓ 遊戲資料移動完成', pct: 100 })
        const newExePath = join(destFolder, relative(srcFolder, exePath))
        return { success: true, moved: true, exePath: newExePath, folderPath: destFolder }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  // Extract archive into folder named after archive file
  ipcMain.handle(
    'games:extractArchive',
    async (_, { archivePath, gamesDir }: { archivePath: string; gamesDir: string }) => {
      try {
        const archiveName = basename(archivePath, extname(archivePath))
        const extractDir = join(gamesDir, archiveName)
        mainWindow?.webContents.send('progress:step', { msg: '正在解壓縮...', pct: 0 })
        await extract7z(archivePath, extractDir)
        mainWindow?.webContents.send('progress:step', { msg: '✓ 解壓縮完成', pct: 100 })
        let detectedCode = extractCodeFromPath(archivePath)
        if (!detectedCode) detectedCode = await findRJCodeInArchive(archivePath)
        return { success: true, extractDir, detectedCode }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  ipcMain.handle('ui:load', () => loadUiSettings())
  ipcMain.handle('ui:save', (_, patch: Record<string, unknown>) => {
    try { ensureDirs(); saveUiSettings(patch); return true } catch (e) { logError('ui:save', e); return false }
  })

  ipcMain.handle('games:scanFolder', (_, folderPath: string) => {
    try {
      const items = readdirSync(folderPath)
      const results: { code: string; name: string; path: string; isDir: boolean }[] = []
      for (const name of items) {
        const match = name.match(/([RVB]J\d{6,8})/i)
        if (match) {
          const code = match[1].toUpperCase()
          const fullPath = join(folderPath, name)
          const stat = statSync(fullPath)
          results.push({ code, name, path: fullPath, isDir: stat.isDirectory() })
        }
      }
      return { success: true, data: results }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('games:getImageData', (_, imgPath: string) => {
    try {
      if (!imgPath || !existsSync(imgPath)) return null
      const data = readFileSync(imgPath)
      const ext = imgPath.split('.').pop()?.toLowerCase() || 'jpg'
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('games:fetchSteamInfo', async (_, appId: string) => {
    try {
      const apiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=tchinese`
      mainWindow?.webContents.send('progress:step', { msg: 'Steam 資訊抓取中...', pct: 0 })
      const text = await fetchHTML(apiUrl)
      const json = JSON.parse(text)
      const entry = json[appId]
      if (!entry?.success || !entry.data) return { success: false, error: '找不到此 Steam 遊戲' }
      const d = entry.data

      const codeImagesDir = join(gameImagesDir, `ST${appId}`)
      mkdirSync(codeImagesDir, { recursive: true })

      const allImages: { url: string; name: string }[] = []
      if (d.header_image) allImages.push({ url: d.header_image, name: 'main' })
      for (const [i, ss] of ((d.screenshots as { path_thumbnail?: string; path_full?: string }[]) ?? []).slice(0, 6).entries()) {
        const url = ss.path_thumbnail || ss.path_full
        if (url) allImages.push({ url, name: `smp${i + 1}` })
      }

      const total = allImages.length
      let done = 0
      let localCover: string | null = null
      const localSamples: string[] = []

      for (const { url, name } of allImages) {
        mainWindow?.webContents.send('progress:step', { msg: `下載圖片 ${done + 1}/${total}`, pct: Math.round((done / Math.max(total, 1)) * 100) })
        const cleanUrl = url.startsWith('//') ? `https:${url}` : url
        const ext = extname(cleanUrl.split('?')[0]) || '.jpg'
        const imgPath = join(codeImagesDir, `${name}${ext}`)
        try {
          await downloadImage(cleanUrl, imgPath)
          if (name === 'main') localCover = imgPath
          else localSamples.push(imgPath)
        } catch { /* skip */ }
        done++
      }
      mainWindow?.webContents.send('progress:step', { msg: `✓ Steam 資訊完成`, pct: 100 })

      return {
        success: true,
        data: {
          title: (d.name as string) ?? '',
          circle: ((d.developers as string[]) ?? []).join(' / '),
          tags: ((d.genres as { description: string }[]) ?? []).map((g) => g.description),
          coverUrl: (d.header_image as string) ?? null,
          localCover,
          releaseDate: (d.release_date as { date?: string })?.date ?? null,
          sampleImages: localSamples,
          workType: null,
          dlsiteRating: null
        }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('games:uploadImage', async (_, { gameId, role }: { gameId: string; role: 'cover' | 'sample' }) => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '圖片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (r.canceled) return null
    const srcPath = r.filePaths[0]
    const ext = extname(srcPath).toLowerCase() || '.jpg'
    const destDir = join(gameImagesDir, gameId)
    mkdirSync(destDir, { recursive: true })
    const destName = role === 'cover' ? `main${ext}` : `smp_${Date.now()}${ext}`
    const destPath = join(destDir, destName)
    copyFileSync(srcPath, destPath)
    return destPath
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
