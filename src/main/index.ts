import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename, extname, relative, parse as parsePath, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  createWriteStream,
  cpSync
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
const gameImagesDir = join(appRoot, 'game-images')

interface Settings {
  gamesDir: string | null
}

function ensureDirs(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  if (!existsSync(gameImagesDir)) mkdirSync(gameImagesDir, { recursive: true })
}

function loadSettings(): Settings {
  if (!existsSync(settingsFile)) return { gamesDir: null }
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf-8'))
  } catch {
    return { gamesDir: null }
  }
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

// Move a directory; falls back to copy+delete for cross-drive moves
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      cpSync(src, dest, { recursive: true })
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
async function extract7z(archivePath: string, outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })
  await execFileAsync(path7za, ['x', archivePath, `-o${outputDir}`, '-y'])
}

function fetchHTML(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'))
    const options = {
      headers: {
        Cookie: 'locale=zh_TW',
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
    title = title.replace(/\s*[|｜]\s*DLsite.*$/, '').trim()

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
        sampleImages: g.sampleImages ?? [],
        isFavorite: g.isFavorite ?? false
      }))
      return raw
    } catch {
      return { games: [] }
    }
  })

  ipcMain.handle('games:save', (_, data) => {
    try {
      ensureDirs()
      writeFileSync(gamesFile, JSON.stringify(data, null, 2), 'utf-8')
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
      // Don't unref — keep tracking so we can measure play time
      child.on('close', () => {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        mainWindow?.webContents.send('game:session-end', { gameId, elapsed })
      })
      return true
    } catch {
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
      if (!found) return { willMove: false }
      const { ancestor: srcFolder, code } = found
      const destFolder = join(gamesDir, basename(srcFolder))
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

  // Move game folder to library (auto-detects RJ ancestor)
  ipcMain.handle(
    'games:moveToLibrary',
    async (_, { exePath, gamesDir }: { exePath: string; gamesDir: string }) => {
      try {
        const found = findRJAncestorFromPath(exePath)
        if (!found) {
          return { success: true, moved: false, exePath, folderPath: dirname(exePath) }
        }
        const { ancestor: srcFolder } = found
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
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
