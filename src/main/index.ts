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
import iconv from 'iconv-lite'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js') as (opts: { wasmBinary: Buffer }) => Promise<{ Database: new (data: Buffer) => { exec: (sql: string) => { columns: string[]; values: unknown[][] }[] } }>
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Converter: OpenCCConverter } = require('opencc-js') as { Converter: (opts: { from: string; to: string }) => (text: string) => string }
const convertToTW = OpenCCConverter({ from: 'cn', to: 'tw' })

import icon from '../../resources/icon.png?asset'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { path7za } = require('7zip-bin') as { path7za: string }
const execFileAsync = promisify(execFile)

function getAppRoot(): string {
  if (!app.isPackaged) {
    return process.env.GAME_DATA_ROOT || app.getAppPath()
  }
  const exeDir = dirname(app.getPath('exe'))
  if (existsSync(join(exeDir, 'data', 'games.json'))) return exeDir
  return app.getPath('userData')
}
const appRoot = getAppRoot()
const dataDir = join(appRoot, 'data')
const gamesFile = join(dataDir, 'games.json')
const settingsFile = join(dataDir, 'settings.json')
const uiSettingsFile = join(dataDir, 'ui-settings.json')
const gameImagesDir = join(appRoot, 'game-images')
const logDir = join(appRoot, 'logs')

interface Settings {
  gamesDir: string | null
  leProcPath: string | null
  fetchDescriptionOnFetch: boolean
  sakuraApiUrl: string | null
  translationTargetLang: string
  autoTranslateOnFetch: boolean
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true }))
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1
  return n
}

async function copyDirProgress(
  src: string,
  dest: string,
  counter: { done: number },
  total: number,
  onStep: (done: number, total: number) => void
): Promise<void> {
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dest, e.name)
    if (e.isDirectory()) {
      await copyDirProgress(s, d, counter, total, onStep)
    } else {
      copyFileSync(s, d)
      counter.done++
      onStep(counter.done, total)
    }
  }
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
  const defaults: Settings = { gamesDir: null, leProcPath: null, fetchDescriptionOnFetch: false, sakuraApiUrl: null, translationTargetLang: 'zh-TW', autoTranslateOnFetch: false }
  if (!existsSync(settingsFile)) return defaults
  try {
    const s = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    return {
      gamesDir: s.gamesDir ?? null,
      leProcPath: s.leProcPath ?? null,
      fetchDescriptionOnFetch: s.fetchDescriptionOnFetch ?? false,
      sakuraApiUrl: s.sakuraApiUrl ?? null,
      translationTargetLang: s.translationTargetLang ?? 'zh-TW',
      autoTranslateOnFetch: s.autoTranslateOnFetch ?? false
    }
  } catch {
    return defaults
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


async function callSakuraApi(text: string, targetLang: string, apiUrl: string): Promise<string> {
  const isEn = targetLang === 'en'
  const systemPrompt = isEn
    ? 'You are a professional translator. Translate the Japanese text to English naturally and accurately.'
    : '你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。'
  const userPrompt = isEn
    ? `Translate to English:\n${text}`
    : `将下面的日文文本翻译成简体中文：\n${text}`
  const base = apiUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sukinishiro',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.1,
      max_tokens: 1024,
      stream: false
    })
  })
  if (!res.ok) throw new Error(`Sakura API ${res.status} ${res.statusText}`)
  const json = await res.json() as { choices: { message: { content: string } }[] }
  let result = json.choices[0]?.message?.content?.trim() ?? ''
  // Sakura outputs Simplified Chinese; post-process to Traditional via OpenCC
  if (targetLang === 'zh-TW' && result) result = convertToTW(result)
  return result
}

async function translateDescriptionHtml(html: string, gameId: string, targetLang: string, apiUrl: string): Promise<string> {
  const uniqueTexts = new Set<string>()
  for (const m of html.matchAll(/>([^<]+)</g)) {
    const t = m[1].trim()
    if (t.length > 2) uniqueTexts.add(t)
  }
  if (uniqueTexts.size === 0) return html
  const translationMap = new Map<string, string>()
  for (const text of uniqueTexts) {
    try { translationMap.set(text, await callSakuraApi(text, targetLang, apiUrl)) }
    catch { translationMap.set(text, text) }
  }
  const translatedHtml = html.replace(/>([^<]+)</g, (match, text) => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length <= 2) return match
    const tr = translationMap.get(trimmed)
    if (!tr) return match
    return '>' + (text.match(/^\s*/)?.[0] ?? '') + tr + (text.match(/\s*$/)?.[0] ?? '') + '<'
  })
  writeFileSync(join(gameImagesDir, gameId, 'description.html'), translatedHtml, 'utf-8')
  return translatedHtml
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

// Charset-aware fetch that also captures Set-Cookie headers and follows redirects with cookies.
// Returns { html, cookies } where cookies is a "; "-joined string ready for the next request.
function fetchHTMLGetCookies(
  url: string,
  cookie: string,
  redirectCount = 0
): Promise<{ html: string; cookies: string; charset: string }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'))
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    }
    httpsGet(url, options, (res: IncomingMessage) => {
      // Accumulate Set-Cookie into a single cookie string
      const newPairs: string[] = ((res.headers['set-cookie'] as string[] | undefined) ?? [])
        .map((c) => c.split(';')[0])
      const merged = [cookie, ...newPairs].filter(Boolean).join('; ')

      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location = res.headers.location
        res.resume()
        if (!location) return reject(new Error('Redirect without location'))
        const next = location.startsWith('http') ? location : new URL(location, url).toString()
        fetchHTMLGetCookies(next, merged, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let charset = 'utf-8'
        const ct = (res.headers['content-type'] || '') as string
        const ctMatch = ct.match(/charset=([^\s;]+)/i)
        if (ctMatch) charset = ctMatch[1].toLowerCase()
        else {
          const preview = buf.slice(0, 2048).toString('latin1')
          const metaMatch = preview.match(/charset=["']?([^"';\s>]+)/i)
          if (metaMatch) charset = metaMatch[1].toLowerCase()
        }
        if (charset === 'shift_jis' || charset === 'sjis' || charset === 'x-sjis') charset = 'shift-jis'
        if (charset === 'euc-jp' || charset === 'x-euc-jp') charset = 'euc-jp'
        let html: string
        try { html = new TextDecoder(charset).decode(buf) } catch { html = buf.toString('utf-8') }
        resolve({ html, cookies: merged, charset })
      })
      res.on('error', reject)
    }).on('error', reject)
  })
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

function downloadImage(url: string, dest: string, redirectCount = 0, cookie = 'locale=zh_TW', referer = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'))
    const imageUrl = url.startsWith('//') ? `https:${url}` : url
    httpsGet(imageUrl, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(referer ? { Referer: referer } : {}) } }, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location = res.headers.location
        res.resume()
        if (!location) return reject(new Error('Redirect without location'))
        const next = location.startsWith('http') ? location : new URL(location, imageUrl).toString()
        downloadImage(next, dest, redirectCount + 1, cookie, referer).then(resolve).catch(reject)
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${imageUrl}`))
      }
      const file = createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', (e) => { file.close(); reject(e) })
    }).on('error', reject)
  })
}

function getWorkURL(code: string, siteId?: string): string {
  if (siteId && siteId !== 'maniax') {
    return `https://www.dlsite.com/${siteId}/work/=/product_id/${code}.html`
  }
  if (code.startsWith('VJ')) return `https://www.dlsite.com/home/work/=/product_id/${code}.html`
  if (code.startsWith('BJ')) return `https://www.dlsite.com/boys-love/work/=/product_id/${code}.html`
  return `https://www.dlsite.com/maniax/work/=/product_id/${code}.html`
}

async function fetchDLsiteProductAPI(code: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://www.dlsite.com/maniax/product/info/ajax?product_id=${code}&lang=ja_JP`
    const raw = await fetchHTML(url)
    const json = JSON.parse(raw)
    // API returns { "RJ12345": {...} } format
    return (json[code] ?? json[code.toUpperCase()] ?? json) as Record<string, unknown>
  } catch {
    return null
  }
}

async function fetchDLsiteInfo(
  code: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    // Pre-fetch product API to get correct site_id, clean title, and fallback data
    const apiData = await fetchDLsiteProductAPI(code)
    const siteId = typeof apiData?.site_id === 'string' ? apiData.site_id : undefined

    const url = getWorkURL(code, siteId)
    const html = await fetchHTML(url)

    // Detect if the fetched HTML is the actual work page.
    // DLsite redirects non-JP IPs to its homepage for some site types (e.g. AIX).
    // Use 'work_outline' (the product info table ID) as the indicator — it only
    // exists on work detail pages, not on the homepage or ranking pages.
    const isWorkPage = html.includes('work_outline')

    // ── Title ────────────────────────────────────────────────────────────
    // API work_name is always clean (no sale badges). Use it as primary source.
    let title: string
    const apiTitle = typeof apiData?.work_name === 'string' ? apiData.work_name : ''
    if (apiTitle) {
      title = apiTitle
    } else if (isWorkPage) {
      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)
      title = titleMatch ? titleMatch[1] : code
      title = title
        .replace(/^【[^】]*?%OFF[^】]*?】\s*/g, '')  // strip sale badges like 【50%OFF】
        .replace(/\s*[|｜]\s*DLsite.*$/, '')
        .replace(/\s*\[[^\]]*\]\s*$/, '')
        .trim()
    } else {
      title = code
    }

    // ── Cover image ──────────────────────────────────────────────────────
    // Only use og:image from HTML if it's actually the work page
    const apiCoverUrl = typeof apiData?.image_main === 'string' ? apiData.image_main : null
    let coverUrl: string | null = apiCoverUrl
    if (isWorkPage) {
      const coverMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)
      if (coverMatch) coverUrl = coverMatch[1]
    }

    // ── Circle / maker ───────────────────────────────────────────────────
    // Use maker_id from API to find the exact circle link; fall back to
    // fetching the circle profile page directly (works even for restricted pages).
    const makerId = typeof apiData?.maker_id === 'string' ? apiData.maker_id : null
    let circle = ''
    if (makerId) {
      const makerMatch = isWorkPage
        ? html.match(new RegExp(`maker_id\\/${makerId}[^"]*"[^>]*>([^<]+)<\\/a>`))
        : null
      if (makerMatch) {
        circle = makerMatch[1].trim()
      } else {
        // Work page is restricted or geo-blocked — fetch circle profile page directly
        try {
          const profileHtml = await fetchHTML(`https://www.dlsite.com/maniax/circle/profile/=/maker_id/${makerId}.html`)
          const isProfilePage = profileHtml.includes('サークルプロフィール') || profileHtml.includes('のプロフィール')
          if (isProfilePage) {
            const profileMatch =
              profileHtml.match(/「([^」]+)」のプロフィール/) ||
              profileHtml.match(/<title>([^|]+?)\s*サークルプロフィール/)
            if (profileMatch) circle = profileMatch[1].replace(/<[^>]+>/g, '').trim()
          }
        } catch { /* ignore */ }
      }
    }
    if (!circle && isWorkPage) {
      const circleMatch = html.match(/class="maker_name"[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/)
      circle = circleMatch ? circleMatch[1].trim() : ''
    }

    // ── Tags (ジャンル) ──────────────────────────────────────────────────────
    const tags: string[] = []
    if (isWorkPage) {
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
      if (tags.length > 50) tags.length = 50
    }

    // ── Work type (作品形式) ──────────────────────────────────────────────
    let workType: string | null = null
    if (isWorkPage) {
      const outlineSection = html.match(/<(?:table|tbody)[^>]*id="work_outline"[^>]*>([\s\S]{0,20000}?)<\/(?:table|tbody)>/)
      const searchIn = outlineSection ? outlineSection[1] : html
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
    if (!workType && typeof apiData?.work_type === 'string') workType = apiData.work_type

    // ── DLsite community rating ──────────────────────────────────────────
    const dlsiteRatingMatch = isWorkPage ? (
      html.match(/"ratingValue"\s*:\s*"([0-9.]+)"/) ||
      html.match(/class="[^"]*count_average[^"]*"[^>]*>\s*([0-9.]+)\s*</) ||
      html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/)
    ) : null
    const dlsiteRating = dlsiteRatingMatch
      ? dlsiteRatingMatch[1].trim()
      : (typeof apiData?.rate_average_2dp === 'number' ? String(apiData.rate_average_2dp) : (typeof apiData?.rating === 'number' ? String(apiData.rating) : null))

    // ── Release date (販売日) ────────────────────────────────────────────
    let releaseDate: string | null = null
    if (isWorkPage) {
      const releaseDateRow = html.match(/<th[^>]*>\s*販売日\s*<\/th>\s*<td[^>]*>([\s\S]{0,300}?)<\/td>/)
      if (releaseDateRow) releaseDate = releaseDateRow[1].replace(/<[^>]+>/g, '').trim() || null
      if (!releaseDate) {
        const rdMatch =
          html.match(/itemprop="datePublished"[^>]*content="([^"]+)"/) ||
          html.match(/(\d{4}年\d{1,2}月\d{1,2}日)/)
        releaseDate = rdMatch ? rdMatch[1].trim() : null
      }
    }
    if (!releaseDate && typeof apiData?.registration_date === 'string') {
      releaseDate = apiData.registration_date
    }

    // ── Sample images ────────────────────────────────────────────────────
    const smpUrlMap = new Map<string, string>() // smpKey → full URL
    if (isWorkPage) {
      for (const m of html.matchAll(/((?:https?:)?\/\/img\.dlsite\.jp[^"'\s<>]+_img_(smp\d+)\.[a-z]+)/gi)) {
        const smpKey = m[2].toLowerCase()
        if (!smpUrlMap.has(smpKey)) smpUrlMap.set(smpKey, m[1])
      }
    }

    // Per-game image subdirectory: game-images/{code}/
    const codeImagesDir = join(gameImagesDir, code)
    mkdirSync(codeImagesDir, { recursive: true })

    const totalImgs = (coverUrl ? 1 : 0) + smpUrlMap.size
    let imgDone = 0

    // Download main cover
    let localCover: string | null = null
    let localListImage: string | null = null
    if (coverUrl) {
      mainWindow?.webContents.send('progress:step', { msg: `下載圖片 ${imgDone + 1}/${totalImgs}`, pct: Math.round((imgDone / Math.max(totalImgs, 1)) * 100) })
      const mainExt = extname(coverUrl) || '.jpg'
      const imgPath = join(codeImagesDir, `main${mainExt}`)
      try {
        await downloadImage(coverUrl, imgPath)
        localCover = imgPath
      } catch { /* ignore */ }
      // Also download the small list thumbnail (_img_sam = _img_main with _main replaced by _sam)
      const samUrl = (coverUrl.startsWith('//') ? `https:${coverUrl}` : coverUrl).replace('_img_main', '_img_sam')
      const samPath = join(codeImagesDir, `sam${mainExt}`)
      try {
        await downloadImage(samUrl, samPath)
        localListImage = samPath
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

    return { success: true, data: { title, circle, tags, coverUrl, localCover, localListImage, releaseDate, workType, dlsiteRating, sampleImages: localSamples } }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

async function fetchGetchuInfo(
  id: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    // ?gc=gc bypasses Getchu age verification directly
    const targetUrl = `https://www.getchu.com/item/${id}?gc=gc`

    const { html } = await fetchHTMLGetCookies(targetUrl, '')

    // ── JSON-LD (primary source for title, brand, images) ────────────────────
    let title = ''
    let circle = ''
    let coverUrl: string | null = null
    let sampleUrls: string[] = []

    const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]+?)<\/script>/)
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1])
        const product = (Array.isArray(ld['@graph']) ? ld['@graph'] : [ld])
          .find((x: Record<string, unknown>) => x['@type'] === 'Product')
        if (product) {
          title = String(product.name ?? '').trim()
          const brand = product.brand as Record<string, unknown> | undefined
          circle = String(brand?.name ?? '').trim()
          const imgs = (product.image as string[] | undefined) ?? []
          if (imgs.length > 0) coverUrl = imgs[0]
          sampleUrls = imgs.slice(1, 9)
        }
      } catch { /* fall through to HTML fallbacks */ }
    }

    // ── HTML fallbacks ────────────────────────────────────────────────────────
    if (!title) {
      const h2 = html.match(/<h2[^>]+id="soft-title"[^>]*>([\s\S]+?)<\/h2>/)
      if (h2) title = h2[1].replace(/<[^>]+>/g, '').trim()
    }
    if (!title) {
      const ogTitle = html.match(/property="og:title"[^>]+content="([^"]+)"/) ||
                      html.match(/content="([^"]+)"[^>]+property="og:title"/)
      if (ogTitle) title = ogTitle[1].replace(/\s*[|｜]\s*.+$/, '').trim()
    }
    if (!title) title = id

    if (!coverUrl) {
      const ogImg = html.match(/property="og:image"[^>]+content="([^"]+)"/) ||
                    html.match(/content="([^"]+)"[^>]+property="og:image"/)
      if (ogImg) {
        coverUrl = ogImg[1].trim()
        if (coverUrl.startsWith('/')) coverUrl = `https://www.getchu.com${coverUrl}`
        else if (coverUrl.startsWith('//')) coverUrl = `https:${coverUrl}`
      }
    }

    if (!circle) {
      const brandLink = html.match(/id="brandsite"[^>]*>([^<]+)</)
      if (brandLink) circle = brandLink[1].trim()
    }

    // ── Release date ─────────────────────────────────────────────────────────
    let releaseDate: string | null = null
    const rdMatch = html.match(/発売日：<\/td>\s*<td[^>]*>\s*<a[^>]*>(\d{4}\/\d{1,2}\/\d{1,2})<\/a>/)
    if (rdMatch) releaseDate = rdMatch[1]

    // ── Tags (Getchu product pages don't have a genre table row) ─────────────
    const tags: string[] = []

    // ── Download images ──────────────────────────────────────────────────────
    // Getchu image URL pattern: rc{id}package.jpg = resized cover (used for both main & list)
    //                           c{id}sample{n}.jpg = sample images
    const rcCoverUrl = `https://www.getchu.com/brandnew/${id}/rc${id}package.jpg`
    const codeImagesDir = join(gameImagesDir, `GC${id}`)
    mkdirSync(codeImagesDir, { recursive: true })
    const totalImgs = 1 + sampleUrls.length  // rc cover + samples
    let imgDone = 0

    mainWindow?.webContents.send('progress:step', { msg: `下載圖片 1/${totalImgs}`, pct: 0 })
    let localCover: string | null = null
    let localListImage: string | null = null
    const gcReferer = 'https://www.getchu.com/'
    try {
      await downloadImage(rcCoverUrl, join(codeImagesDir, 'main.jpg'), 0, '', gcReferer)
      localCover = join(codeImagesDir, 'main.jpg')
      await downloadImage(rcCoverUrl, join(codeImagesDir, 'sam.jpg'), 0, '', gcReferer)
      localListImage = join(codeImagesDir, 'sam.jpg')
    } catch (e) { logError('fetchGetchuInfo:coverDownload', e) }
    imgDone++

    const localSamples: string[] = []
    for (const [i, smpUrl] of sampleUrls.entries()) {
      mainWindow?.webContents.send('progress:step', { msg: `下載圖片 ${imgDone + 1}/${totalImgs}`, pct: Math.round((imgDone / Math.max(totalImgs, 1)) * 100) })
      const imgPath = join(codeImagesDir, `smp${i + 1}.jpg`)
      try { await downloadImage(smpUrl, imgPath, 0, '', gcReferer); localSamples.push(imgPath) } catch (e) { logError('fetchGetchuInfo:sampleDownload', e) }
      imgDone++
    }
    mainWindow?.webContents.send('progress:step', { msg: `✓ 圖片完成 (${imgDone} 張)`, pct: 100 })

    logError('fetchGetchuInfo:done', `id=${id} localCover=${localCover} samples=${localSamples.length} title=${title}`)
    return {
      success: true,
      data: { title, circle, tags, coverUrl: rcCoverUrl, localCover, localListImage, releaseDate, workType: null, dlsiteRating: null, sampleImages: localSamples }
    }
  } catch (e) {
    logError('fetchGetchuInfo:error', e)
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
        infoUpdatedAt: g.infoUpdatedAt ?? null,
        playCount: g.playCount ?? 0,
        playTime: g.playTime ?? 0,
        releaseDate: g.releaseDate ?? null,
        workType: g.workType ?? null,
        dlsiteRating: g.dlsiteRating ?? null,
        sampleImages: ((g.sampleImages as string[]) ?? []).map(toAbsoluteImagePath),
        isFavorite: g.isFavorite ?? false,
        folderSize: g.folderSize ?? null,
        launchLocale: g.launchLocale ?? null,
        cover: g.cover ? toAbsoluteImagePath(g.cover as string) : null,
        listImage: g.listImage ? toAbsoluteImagePath(g.listImage as string) : null
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
          listImage: g.listImage ? toRelativeImagePath(g.listImage as string) : null,
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
    if (result.success && loadSettings().fetchDescriptionOnFetch) {
      mainWindow?.webContents.send('progress:step', { msg: '抓取遊戲介紹...', pct: 50 })
      try {
        const pageHtml = await fetchHTML(getWorkURL(code))
        const sections: string[] = []
        const containerRe = /class="work_parts_container[^"]*"[^>]*>/g
        let cm: RegExpExecArray | null
        while ((cm = containerRe.exec(pageHtml)) !== null) {
          const start = cm.index + cm[0].length
          let depth = 1; let i = start
          while (i < pageHtml.length && depth > 0) {
            const o = pageHtml.indexOf('<div', i); const c = pageHtml.indexOf('</div>', i)
            if (c === -1) break
            if (o !== -1 && o < c) { depth++; i = o + 4 }
            else { depth--; if (depth === 0) { const s = pageHtml.slice(start, c).trim(); if (s) sections.push(s); break }; i = c + 6 }
          }
        }
        if (sections.length > 0) {
          let raw = sections.join('\n')
          raw = raw.replace(/<img([^>]*?)\sdata-src="([^"]+)"([^>]*?)>/gi, (_, b, ds, a) => `<img${(b+a).replace(/\s*\bsrc="[^"]*"/i,'')} src="${ds}">`)
          raw = raw.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
          raw = raw.replace(/\s+class="[^"]*"/gi, '').replace(/<center>/gi, '<div style="text-align:center">').replace(/<\/center>/gi, '</div>')
          const dir = join(gameImagesDir, code)
          mkdirSync(dir, { recursive: true })
          const urlToLocal = new Map<string, string>(); let idx = 0; const seen = new Set<string>()
          for (const im of raw.matchAll(/\bsrc="([^"]+)"/gi)) {
            const abs = im[1].startsWith('//') ? `https:${im[1]}` : im[1]
            if (!abs.startsWith('http') || seen.has(abs)) continue
            seen.add(abs); idx++
            const ext = abs.replace(/\?.*$/,'').match(/\.(\w{2,5})$/)?.[1]?.toLowerCase() || 'jpg'
            const name = `desc_img_${idx}.${ext}`
            try { await downloadImage(abs, join(dir, name)); urlToLocal.set(abs, name) } catch { /**/ }
          }
          const cleaned = raw.replace(/\bsrc="([^"]+)"/gi, (_m, src) => { const abs = src.startsWith('//')?`https:${src}`:src; const l=urlToLocal.get(abs); return l?`src="${l}"`:_m })
          writeFileSync(join(dir, 'description.html'), cleaned, 'utf-8')
          const s = loadSettings()
          if (s.sakuraApiUrl && s.autoTranslateOnFetch) {
            mainWindow?.webContents.send('progress:step', { msg: '翻譯介紹中...', pct: 75 })
            try { await translateDescriptionHtml(cleaned, code, s.translationTargetLang, s.sakuraApiUrl) } catch { /**/ }
          }
        }
      } catch { /**/ }
      mainWindow?.webContents.send('progress:step', { msg: '✓ 完成', pct: 100 })
    }
    return result
  })

  ipcMain.handle('games:suggestFetchDlsite', async (_, term: string) => {
    try {
      const encoded = encodeURIComponent(term)
      const ts = Date.now()
      const url = `https://www.dlsite.com/suggest/?callback=cb&term=${encoded}&site=adult-jp&time=${ts}&touch=0&_=${ts}`
      const text = await fetchHTML(url)
      // JSONP: parse regardless of callback name — find first ( ... )
      const start = text.indexOf('(')
      const end = text.lastIndexOf(')')
      if (start === -1 || end === -1 || end <= start) return { success: false, error: '沒有查詢結果' }
      const data = JSON.parse(text.slice(start + 1, end))
      // Response: { work: [{workno, work_name, maker_name, ...}] }
      const works: Record<string, string>[] = Array.isArray(data) ? data : (data.work ?? [])
      if (!works.length) return { success: false, error: '沒有查詢結果' }
      const first = works[0]
      const id: string = String(first.workno ?? first.id ?? '')
      if (!id || !/^[RVB]J\d{6,8}$/i.test(id)) return { success: false, error: '沒有查詢結果' }
      mainWindow?.webContents.send('progress:step', { msg: `找到 ${id}，抓取資訊中...`, pct: 30 })
      const result = await fetchDLsiteInfo(id)
      mainWindow?.webContents.send('progress:step', { msg: result.success ? '✓ 完成' : '⚠ 抓取失敗', pct: 100 })
      return { ...result, id: id.toUpperCase() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('games:extractCode', (_, str: string) => {
    const match = str.match(/([RVB]J\d{6,8})/i)
    return match ? match[1].toUpperCase() : null
  })

  // Launch exe; track session duration and notify renderer on exit
  ipcMain.handle('games:launch', (_, { exePath, gameId, locale }: { exePath: string; gameId: string; locale?: string | null }) => {
    try {
      const settings = loadSettings()
      const useLE = !!locale && !!settings.leProcPath && existsSync(settings.leProcPath)
      const cmd = useLE ? settings.leProcPath! : exePath
      const args = useLE ? [exePath] : []

      const startTime = Date.now()
      const child = spawn(cmd, args, {
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

  // Convert desc_img_*.* references in stored HTML to inline base64 for renderer display
  function descHtmlToDisplay(html: string, gameId: string): string {
    return html.replace(/src="(desc_img_[^"]+)"/g, (_m, relPath) => {
      const abs = join(gameImagesDir, gameId, relPath)
      if (!existsSync(abs)) return `src=""`
      try {
        const buf = readFileSync(abs)
        const ext = extname(relPath).slice(1).toLowerCase()
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext || 'png'}`
        return `src="data:${mime};base64,${buf.toString('base64')}"`
      } catch { return `src=""` }
    })
  }

  ipcMain.handle('games:loadDescription', (_, gameId: string): string => {
    try {
      const htmlPath = join(gameImagesDir, gameId, 'description.html')
      if (existsSync(htmlPath)) return descHtmlToDisplay(readFileSync(htmlPath, 'utf-8'), gameId)
      const txtPath = join(gameImagesDir, gameId, 'description.txt')
      if (existsSync(txtPath)) return readFileSync(txtPath, 'utf-8')
      return ''
    } catch { return '' }
  })

  ipcMain.handle('games:saveDescription', (_, { gameId, text }: { gameId: string; text: string }): boolean => {
    try {
      const dir = join(gameImagesDir, gameId)
      mkdirSync(dir, { recursive: true })
      const p = join(dir, 'description.html')
      if (text.trim()) {
        writeFileSync(p, text, 'utf-8')
      } else if (existsSync(p)) {
        unlinkSync(p)
      }
      return true
    } catch (e) { logError('games:saveDescription', e); return false }
  })

  ipcMain.handle('games:fetchDLsiteDescription', async (_, code: string) => {
    try {
      const url = getWorkURL(code)
      const pageHtml = await fetchHTML(url)

      // Extract work_parts_container blocks with div-depth counting
      const sections: string[] = []
      const containerRe = /class="work_parts_container[^"]*"[^>]*>/g
      let m: RegExpExecArray | null
      while ((m = containerRe.exec(pageHtml)) !== null) {
        const start = m.index + m[0].length
        let depth = 1; let i = start
        while (i < pageHtml.length && depth > 0) {
          const o = pageHtml.indexOf('<div', i)
          const c = pageHtml.indexOf('</div>', i)
          if (c === -1) break
          if (o !== -1 && o < c) { depth++; i = o + 4 }
          else { depth--; if (depth === 0) { const s = pageHtml.slice(start, c).trim(); if (s) sections.push(s); break }; i = c + 6 }
        }
      }
      if (sections.length === 0) return { success: false, error: '找不到介紹區塊' }

      // ── Clean raw HTML ──────────────────────────────────────────────────────
      let raw = sections.join('\n')
      // 1. Normalize lazy-load images: data-src → src
      raw = raw.replace(/<img([^>]*?)\sdata-src="([^"]+)"([^>]*?)>/gi, (_, before, dataSrc, after) => {
        const rest = (before + after).replace(/\s*\bsrc="[^"]*"/i, '')
        return `<img${rest} src="${dataSrc}">`
      })
      // 2. Strip scripts/styles
      raw = raw.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
      // 3. Remove class attributes; convert <center> to div
      raw = raw.replace(/\s+class="[^"]*"/gi, '').replace(/<center>/gi, '<div style="text-align:center">').replace(/<\/center>/gi, '</div>')

      // ── Download images ─────────────────────────────────────────────────────
      const dir = join(gameImagesDir, code)
      mkdirSync(dir, { recursive: true })
      const urlToLocal = new Map<string, string>()
      let imgIdx = 0
      const imgRe = /\bsrc="([^"]+)"/gi
      const seenUrls = new Set<string>()
      for (const im of raw.matchAll(imgRe)) {
        const src = im[1]
        const abs = src.startsWith('//') ? `https:${src}` : src
        if (!abs.startsWith('http') || seenUrls.has(abs)) continue
        seenUrls.add(abs)
        imgIdx++
        const ext = src.replace(/\?.*$/, '').match(/\.(\w{2,5})$/)?.[1]?.toLowerCase() || 'jpg'
        const localName = `desc_img_${imgIdx}.${ext}`
        const localPath = join(dir, localName)
        try {
          await downloadImage(abs, localPath)
          urlToLocal.set(abs, localName)
        } catch { /* keep original */ }
      }

      // ── Replace image URLs with local filenames ─────────────────────────────
      let cleaned = raw.replace(/\bsrc="([^"]+)"/gi, (match, src) => {
        const abs = src.startsWith('//') ? `https:${src}` : src
        const local = urlToLocal.get(abs)
        return local ? `src="${local}"` : match
      })

      writeFileSync(join(dir, 'description.html'), cleaned, 'utf-8')
      return { success: true, description: descHtmlToDisplay(cleaned, code) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('games:loadTranslatedDescription', (_, gameId: string): string => {
    try {
      const p = join(gameImagesDir, gameId, 'description_translated.txt')
      return existsSync(p) ? readFileSync(p, 'utf-8') : ''
    } catch { return '' }
  })

  ipcMain.handle('games:translateDescription', async (_, gameId: string) => {
    try {
      const settings = loadSettings()
      if (!settings.sakuraApiUrl) return { success: false, error: '未設定 Sakura API URL' }
      const htmlPath = join(gameImagesDir, gameId, 'description.html')
      if (!existsSync(htmlPath)) return { success: false, error: '無介紹資料可翻譯' }
      const html = readFileSync(htmlPath, 'utf-8')
      const translatedHtml = await translateDescriptionHtml(html, gameId, settings.translationTargetLang, settings.sakuraApiUrl)
      return { success: true, description: descHtmlToDisplay(translatedHtml, gameId) }
    } catch (e) {
      logError('games:translateDescription', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('shell:openExternal', (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:openGetchuSearch', (_, keyword: string) => {
    // Getchu uses EUC-JP — encode keyword to EUC-JP bytes then percent-encode
    const buf: Buffer = iconv.encode(keyword, 'EUC-JP')
    const encoded = Array.from(buf)
      .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
      .join('')
    shell.openExternal(
      `https://www.getchu.com/php/search.phtml?genre=all&search_keyword=${encoded}&check_key_dtl=1&submit=`
    )
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

  // Move a known folder directly into gamesDir (used by scan-folder batch add)
  ipcMain.handle(
    'games:moveFolderToLibrary',
    async (_, { srcFolder, gamesDir }: { srcFolder: string; gamesDir: string }) => {
      try {
        const destFolder = join(gamesDir, basename(srcFolder))
        if (existsSync(destFolder)) return { success: false, error: `目標資料夾已存在：${destFolder}` }
        mkdirSync(gamesDir, { recursive: true })
        mainWindow?.webContents.send('progress:step', { msg: '正在移動遊戲資料...', pct: 0 })
        await moveDir(srcFolder, destFolder)
        mainWindow?.webContents.send('progress:step', { msg: '✓ 移動完成', pct: 100 })
        return { success: true, newFolderPath: destFolder }
      } catch (e) {
        return { success: false, error: String(e) }
      }
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

  // ── Import from GameManager 0.49 (SQLite) ────────────────────────────────
  ipcMain.handle('import:selectDb', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
      title: '選擇 Games.db'
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('import:preview', async (_, dbPath: string) => {
    try {
      const wasmPath = join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
      const wasmBinary = readFileSync(wasmPath)
      const SQL = await initSqlJs({ wasmBinary })
      const db = new SQL.Database(readFileSync(dbPath))
      const result = db.exec('SELECT COUNT(*) FROM game')
      const count = result[0]?.values[0]?.[0] ?? 0
      return { success: true, count }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('import:run', async (_, { dbPath, skipDuplicates, existingIds }: {
    dbPath: string; skipDuplicates: boolean; existingIds: string[]
  }) => {
    try {
      const wasmPath = join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
      const wasmBinary = readFileSync(wasmPath)
      const SQL = await initSqlJs({ wasmBinary })
      const db = new SQL.Database(readFileSync(dbPath))
      const imagesDir = join(dirname(dbPath), 'Images')

      // Load circles
      const circleMap = new Map<number, string>()
      const circleResult = db.exec('SELECT CircleID, Name FROM circle')
      if (circleResult.length > 0) {
        for (const row of circleResult[0].values) {
          circleMap.set(row[0] as number, (row[1] as string) ?? '')
        }
      }

      // Load images
      const imageMap = new Map<number, { path: string; isList: boolean; isCover: boolean }[]>()
      const imgResult = db.exec('SELECT GameID, ImagePath, IsListImage, IsCoverImage FROM image')
      if (imgResult.length > 0) {
        for (const row of imgResult[0].values) {
          const gameId = row[0] as number
          const entry = { path: (row[1] as string) ?? '', isList: !!(row[2] as number), isCover: !!(row[3] as number) }
          const arr = imageMap.get(gameId) ?? []
          arr.push(entry)
          imageMap.set(gameId, arr)
        }
      }

      // Load games
      const gameResult = db.exec(`
        SELECT GameID, RJCode, Title, FolderPath, Rating, DLSRating,
               ReleaseDate, AddedDate, LastPlayedDate, TimesPlayed, SecondsPlayed,
               CircleID, Tags, Comments, Language, Size
        FROM game
      `)

      const imported: Record<string, unknown>[] = []
      let skipped = 0
      const errors: string[] = []

      if (gameResult.length > 0) {
        for (const row of gameResult[0].values) {
          try {
            const [gameId, rjCode, title, folderPath, rating, dlsRating,
              releaseDate, addedDate, lastPlayedDate, timesPlayed, secondsPlayed,
              circleId, tags, comments, language, size] = row

            const id = (rjCode as string | null)?.trim().toUpperCase() || `NF_IMP_${gameId}`

            if (skipDuplicates && existingIds.includes(id)) { skipped++; continue }

            // Format dates
            const fmtDate = (v: unknown): string | null => {
              if (!v) return null
              const d = new Date(v as string)
              if (isNaN(d.getTime())) return null
              const pad = (n: number) => String(n).padStart(2, '0')
              return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
            }

            // Process images
            const imgs = imageMap.get(gameId as number) ?? []
            let cover: string | null = null
            let listImage: string | null = null
            const sampleImages: string[] = []
            const codeImagesDir = join(gameImagesDir, id)
            mkdirSync(codeImagesDir, { recursive: true })
            let smpN = 1

            for (const img of imgs) {
              const srcPath = img.path.startsWith('Images\\') || img.path.startsWith('Images/')
                ? join(dirname(dbPath), img.path)
                : join(imagesDir, img.path)
              if (!existsSync(srcPath)) continue
              const ext = extname(srcPath) || '.jpg'
              try {
                if (img.isList) {
                  const dest = join(codeImagesDir, `sam${ext}`)
                  copyFileSync(srcPath, dest)
                  listImage = dest
                } else if (img.isCover) {
                  const dest = join(codeImagesDir, `main${ext}`)
                  copyFileSync(srcPath, dest)
                  cover = dest
                } else {
                  const dest = join(codeImagesDir, `smp${smpN}${ext}`)
                  copyFileSync(srcPath, dest)
                  sampleImages.push(dest)
                  smpN++
                }
              } catch { /* skip unavailable image */ }
            }

            // Determine path/exe from FolderPath
            let gamePath: string | null = null
            let exe: string | null = null
            if (folderPath) {
              const fp = folderPath as string
              try {
                if (existsSync(fp)) {
                  const st = statSync(fp)
                  if (st.isDirectory()) {
                    gamePath = fp
                  } else if (st.isFile()) {
                    exe = fp
                    gamePath = dirname(fp)
                  }
                }
              } catch { gamePath = null }
            }

            // Build tag array
            const tagList = tags ? String(tags).split(',').map((t: string) => t.trim()).filter(Boolean) : []

            const game: Record<string, unknown> = {
              uuid: randomUUID(),
              id,
              title: (title as string | null) ?? id,
              circle: circleId ? (circleMap.get(circleId as number) ?? '') : '',
              tags: tagList,
              cover: cover ? toRelativeImagePath(cover) : null,
              listImage: listImage ? toRelativeImagePath(listImage) : null,
              coverUrl: null,
              sampleImages: sampleImages.map(toRelativeImagePath),
              path: gamePath,
              exe,
              rating: typeof rating === 'number' ? rating : 0,
              note: (comments as string | null) ?? '',
              addedAt: fmtDate(addedDate) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
              language: (language as string | null) ?? 'ja',
              releaseDate: fmtDate(releaseDate),
              workType: null,
              dlsiteRating: dlsRating != null ? String(dlsRating) : null,
              lastPlayedAt: fmtDate(lastPlayedDate),
              playCount: (timesPlayed as number | null) ?? 0,
              playTime: (secondsPlayed as number | null) ?? 0,
              isFavorite: false,
              folderSize: size != null ? (size as number) * 1024 : null
            }
            imported.push(game)
          } catch (e) {
            errors.push(String(e))
          }
        }
      }

      return { success: true, imported, skipped, errors }
    } catch (e) {
      logError('import:run', e)
      return { success: false, error: String(e), imported: [], skipped: 0, errors: [] }
    }
  })

  ipcMain.handle('games:scanFolder', (_, folderPath: string) => {
    try {
      const skipNames = ['setup', 'install', 'uninstall', 'uachelper', 'directx', 'vcredist', 'dotnet']
      function findExeInDir(dir: string, depth: number): string | null {
        if (depth > 4) return null
        let items: string[]
        try { items = readdirSync(dir) } catch { return null }
        for (const name of ['game.exe', 'app.exe', 'nw.exe', 'rpg_rt.exe']) {
          if (items.map(i => i.toLowerCase()).includes(name)) return join(dir, name)
        }
        for (const item of items) {
          const lower = item.toLowerCase()
          if (lower.endsWith('.exe') && !skipNames.some(s => lower.includes(s))) return join(dir, item)
        }
        for (const item of items) {
          const full = join(dir, item)
          try {
            if (statSync(full).isDirectory()) {
              const found = findExeInDir(full, depth + 1)
              if (found) return found
            }
          } catch { /* skip */ }
        }
        return null
      }
      const entries = readdirSync(folderPath, { withFileTypes: true })
      const results: { folderPath: string; folderName: string; detectedCode: string | null; detectedExe: string | null }[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const name = entry.name
        const fullPath = join(folderPath, name)
        const codeMatch = name.match(/([RVB]J\d{6,8})/i)
        const stMatch = !codeMatch ? name.match(/\bST(\d+)\b/i) : null
        const gcMatch = !codeMatch && !stMatch ? name.match(/\bGC(\d{5,10})\b/i) : null
        const detectedCode = codeMatch ? codeMatch[1].toUpperCase() : stMatch ? `ST${stMatch[1]}` : gcMatch ? `GC${gcMatch[1]}` : null
        const detectedExe = findExeInDir(fullPath, 0)
        results.push({ folderPath: fullPath, folderName: name, detectedCode, detectedExe })
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

  ipcMain.handle('games:fetchGetchuInfo', async (_, id: string) => {
    mainWindow?.webContents.send('progress:step', { msg: 'Getchu 資訊抓取中...', pct: 0 })
    const result = await fetchGetchuInfo(id)
    mainWindow?.webContents.send('progress:step', { msg: result.success ? '✓ 資訊抓取完成' : '⚠ 無法取得資訊', pct: 100 })
    return result
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

  ipcMain.handle('games:uploadImage', async (_, { gameId, role }: { gameId: string; role: 'cover' | 'sample' | 'listImage' }) => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '圖片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (r.canceled) return null
    const srcPath = r.filePaths[0]
    const ext = extname(srcPath).toLowerCase() || '.jpg'
    const destDir = join(gameImagesDir, gameId)
    mkdirSync(destDir, { recursive: true })
    const destName = role === 'cover' ? `main${ext}` : role === 'listImage' ? `sam${ext}` : `smp_${Date.now()}${ext}`
    const destPath = join(destDir, destName)
    copyFileSync(srcPath, destPath)
    return destPath
  })

  // ── Data location & migration ─────────────────────────────────────────────
  ipcMain.handle('data:getLocationInfo', () => {
    if (!app.isPackaged) {
      return { isDev: true, isPortable: false, currentRoot: appRoot, exeDir: null, appDataDir: null }
    }
    const exeDir = dirname(app.getPath('exe'))
    return {
      isDev: false,
      isPortable: appRoot === exeDir,
      currentRoot: appRoot,
      exeDir,
      appDataDir: app.getPath('userData')
    }
  })

  ipcMain.handle('data:migrateToPortable', async () => {
    if (!app.isPackaged) return { success: false, error: '開發模式不支援搬移' }
    const exeDir = dirname(app.getPath('exe'))
    if (appRoot === exeDir) return { success: false, error: '已是攜帶式模式' }
    try {
      const srcData = join(appRoot, 'data')
      const srcImages = join(appRoot, 'game-images')
      const total = countFiles(srcData) + countFiles(srcImages)
      const counter = { done: 0 }
      const onStep = (done: number, tot: number): void => {
        mainWindow?.webContents.send('progress:step', { msg: `正在複製... (${done}/${tot})`, pct: Math.round((done / Math.max(tot, 1)) * 88) })
      }
      mainWindow?.webContents.send('progress:step', { msg: '正在複製資料...', pct: 0 })
      await copyDirProgress(srcData, join(exeDir, 'data'), counter, total, onStep)
      await copyDirProgress(srcImages, join(exeDir, 'game-images'), counter, total, onStep)
      mainWindow?.webContents.send('progress:step', { msg: '正在清除原始資料...', pct: 92 })
      await rm(srcData, { recursive: true, force: true })
      await rm(srcImages, { recursive: true, force: true })
      mainWindow?.webContents.send('progress:step', { msg: '完成！正在重新啟動...', pct: 100 })
      setTimeout(() => { app.relaunch(); app.exit(0) }, 1500)
      return { success: true }
    } catch (e) {
      logError('data:migrateToPortable', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('data:migrateToAppData', async () => {
    if (!app.isPackaged) return { success: false, error: '開發模式不支援搬移' }
    const exeDir = dirname(app.getPath('exe'))
    if (appRoot !== exeDir) return { success: false, error: '目前不是攜帶式模式' }
    const appDataDir = app.getPath('userData')
    try {
      const srcData = join(exeDir, 'data')
      const srcImages = join(exeDir, 'game-images')
      const total = countFiles(srcData) + countFiles(srcImages)
      const counter = { done: 0 }
      const onStep = (done: number, tot: number): void => {
        mainWindow?.webContents.send('progress:step', { msg: `正在複製... (${done}/${tot})`, pct: Math.round((done / Math.max(tot, 1)) * 88) })
      }
      mainWindow?.webContents.send('progress:step', { msg: '正在複製資料...', pct: 0 })
      await copyDirProgress(srcData, join(appDataDir, 'data'), counter, total, onStep)
      await copyDirProgress(srcImages, join(appDataDir, 'game-images'), counter, total, onStep)
      mainWindow?.webContents.send('progress:step', { msg: '正在清除攜帶式資料...', pct: 92 })
      await rm(srcData, { recursive: true, force: true })
      await rm(srcImages, { recursive: true, force: true })
      mainWindow?.webContents.send('progress:step', { msg: '完成！正在重新啟動...', pct: 100 })
      setTimeout(() => { app.relaunch(); app.exit(0) }, 1500)
      return { success: true }
    } catch (e) {
      logError('data:migrateToAppData', e)
      return { success: false, error: String(e) }
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
