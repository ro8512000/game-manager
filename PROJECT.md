# Game Manager — 專案說明文件

> ## ⚠ 給 AI 助理的開發規則（必讀）
>
> 1. **每次完成功能實作或 bug fix 後，必須立即更新本文件**，不等使用者提醒、不等到最後才補。
> 2. 更新範圍：新增/變更/移除的功能說明、IPC 通道、資料欄位、元件行為、已知注意事項、指令等。
> 3. 保持文件與程式碼一致，讓下一位 AI 讀取此文件即可理解目前的專案狀態。

## 概覽

Windows 桌面應用程式，功能類似 Steam，用來管理 DLsite / Steam / Getchu 遊戲庫。  
技術棧：**Electron 39 + electron-vite + React 19 + TypeScript**

---

## 目錄結構

```
game-manager/
├── src/
│   ├── main/index.ts          ← Electron 主程式（IPC handlers、爬蟲、檔案操作）
│   ├── preload/index.ts       ← contextBridge 暴露 API
│   └── renderer/src/
│       ├── App.tsx            ← 主程式入口、狀態管理
│       ├── App.css            ← 全域深色主題樣式
│       ├── types.ts           ← 型別定義（Game、ColumnDef、ALL_COLUMNS 等）
│       ├── electron.d.ts      ← window.electronAPI 型別宣告
│       ├── utils.ts           ← 工具函式（findDuplicates / getGroupValue / getGameSortValue 等）
│       └── components/
│           ├── Sidebar.tsx        ← 左側篩選欄
│           ├── GameGrid.tsx       ← 磁磚瀏覽容器
│           ├── GameCard.tsx       ← 磁磚卡片（16:9 比例）
│           ├── GameList.tsx       ← 列表瀏覽（排序/分組/hover預覽/縮圖）
│           ├── GameDetail.tsx     ← 右側詳情面板（可拉寬）
│           ├── ImageLightbox.tsx  ← 圖片燈箱（鍵盤/滾輪切換）
│           ├── GameContextMenu.tsx← 右鍵選單
│           ├── AddGameModal.tsx   ← 新增遊戲（自動偵測代碼、進度條）
│           ├── DuplicateModal.tsx ← 重複遊戲偵測
│           ├── BatchFetchModal.tsx← 批量重新抓取 DLsite 資訊
│           ├── ImportModal.tsx    ← 匯入舊版 GameManager 0.49 資料
│           ├── ScanFolderModal.tsx← 掃描資料夾批量加入遊戲
│           └── SettingsModal.tsx  ← 設定（遊戲儲存目錄）
├── data/
│   ├── games.json             ← 遊戲資料庫
│   ├── settings.json          ← 使用者設定（gamesDir）
│   └── ui-settings.json       ← UI 狀態持久化（視圖、欄位、視窗大小等）
├── game-images/               ← 封面圖快取（每款遊戲獨立子資料夾）
│   └── {code}/
│       ├── main.jpg           ← 主封面
│       ├── sam.jpg            ← 列表縮圖（_img_sam，25x25 小圖）
│       ├── smp1.webp          ← 樣本圖 1
│       └── smp2.webp ...
├── logs/                      ← 錯誤日誌（自動清除 3 天前的）
└── PROJECT.md                 ← 本文件
```

> `.gitignore` 已排除：`game-images/`、`data/`、`logs/`

---

## 資料模型（Game）

```typescript
interface Game {
  uuid: string              // 唯一識別碼（真正的主鍵，自動生成）
  id: string                // 遊戲代碼：RJ/VJ/BJ（DLsite）、ST{appId}（Steam）、NF001...（無代碼）
  title: string
  circle: string            // 社團名 / 開發商
  tags: string[]
  cover: string | null      // 本地封面圖相對路徑（game-images/{code}/main.jpg）
  listImage: string | null  // 列表縮圖相對路徑（game-images/{code}/sam.jpg）；Steam 遊戲不使用
  coverUrl: string | null   // 遠端封面 URL（備用）
  sampleImages: string[]    // 樣本圖本地相對路徑陣列
  path: string | null       // 遊戲資料夾路徑
  exe: string | null        // 啟動 exe 路徑
  launchLocale: string | null  // Locale Emulator 語系（null=正常啟動；'ja'/'zh-TW'/'zh-CN'/'ko'=LE 啟動）
  rating: number            // 個人評分 0-5
  note: string
  addedAt: string           // 加入時間（YYYY-MM-DD HH:MM:SS）
  language: string
  releaseDate: string | null   // 發售日
  workType: string | null      // 作品形式
  dlsiteRating: string | null  // DLsite 社群評分
  lastPlayedAt: string | null  // 上次遊玩時間
  playCount: number            // 遊玩次數
  playTime: number             // 累積遊玩時間（秒）
  isFavorite: boolean
  folderSize: number | null    // 遊戲資料夾大小（bytes），加入時自動計算
}
```

> **重要**：所有身份比對一律使用 `uuid`，`id` 只是屬性。  
> 圖片路徑存相對路徑（如 `RJ01234/main.jpg`），載入時動態展開為絕對路徑，搬移專案目錄不影響圖片。

---

## 遊戲代碼規則

| 前綴 | 來源 | 範例 |
|------|------|------|
| `RJ` / `VJ` / `BJ` | DLsite | RJ01234567 |
| `ST{appId}` | Steam | ST2074890 |
| `GC{id}` | Getchu | GC1355691 |
| `NF001`, `NF002`... | 無代碼（自動指派） | NF001 |

---

## 設定檔

### settings.json
```json
{ "gamesDir": "G:/Games", "leProcPath": "C:/LEd/LEProc.exe" }
```
- `gamesDir`：新增遊戲時，遊戲資料夾移動/解壓縮的目標目錄
- `leProcPath`：Locale Emulator 的 `LEProc.exe` 路徑；設定後可對個別遊戲啟用 LE 啟動

### ui-settings.json
所有 UI 狀態存此檔（不用 localStorage，避免 dev server port 變動造成重置）：

| key | 說明 |
|-----|------|
| `viewMode` | `'grid'` 或 `'list'` |
| `listColumns` | 可見欄位 key 陣列（有序） |
| `listColWidths` | 欄寬 `{key: px}` |
| `listSortKey` / `listSortDir` | 列表排序欄位 / 方向 |
| `listGroupBy` | 列表分組欄位 |
| `gridSortKey` / `gridSortDir` | 磁磚排序欄位 / 方向 |
| `detailWidth` | 右側面板寬度（px） |
| `windowWidth` / `windowHeight` | 視窗大小 |
| `filterRating` | 評分篩選值 |
| `favoritesOnly` | 我的最愛篩選 |
| `filterSources` | 來源篩選 `['dlsite','steam','getchu','other']` |
| `ratingCollapsed` / `sourceCollapsed` | 側欄區塊收合狀態 |
| `pageSize` | 分頁大小（`50`/`100`/`250`/`500`/`1000`/`null`=全部顯示） |
| `favoriteTags` | 最愛標籤陣列（置頂顯示） |

---

## IPC 通道（主程式 ↔ renderer）

### 設定
| 通道 | 說明 |
|------|------|
| `settings:load` | 讀取 settings.json |
| `settings:save` | 儲存 settings.json |
| `ui:load` | 讀取 ui-settings.json |
| `ui:save(patch)` | 合併更新 ui-settings.json |

### 遊戲資料
| 通道 | 說明 |
|------|------|
| `games:load` | 讀取 games.json（自動補缺少欄位、展開圖片相對路徑） |
| `games:save` | 儲存 games.json（壓縮圖片路徑為相對路徑） |
| `games:fetchInfo(code)` | DLsite 抓取（日文）：標題/社團/tag/評分/發售日/圖片（含 sam.jpg） |
| `games:fetchSteamInfo(appId)` | Steam API 抓取：標題/開發商/tag/發售日/截圖 |
| `games:fetchGetchuInfo(id)` | Getchu 抓取：標題/社團/發售日/封面+樣本圖（JSON-LD 解析；年齢認証用 `?gc=gc` 繞過） |
| `games:suggestFetchDlsite(term)` | 用遊戲名稱查詢 DLsite suggest API → 取第一個 RJ/VJ/BJ 代碼 → 自動抓取並回傳 DLsite 資訊；找不到時回傳 `{success:false, error:'沒有查詢結果'}` |
| `games:extractCode(str)` | 從字串擷取 RJ/VJ/BJ 代碼 |
| `games:scanFolder(folderPath)` | 掃描直接子資料夾：偵測 RJ/VJ/BJ/ST/GC 代碼 + 遞迴找 exe（深度≤4），回傳 `{folderPath, folderName, detectedCode, detectedExe}[]` |

### 遊戲操作
| 通道 | 說明 |
|------|------|
| `games:launch({exePath, gameId, locale?})` | spawn 啟動 exe（detached，計時，記錄錯誤）；locale 有值且設定了 leProcPath 時改用 `LEProc.exe {exePath}` 啟動 |
| `games:openFolder(path)` | shell.openPath 開啟資料夾 |
| `games:findExe(folderPath)` | 在資料夾內搜尋 exe（深度≤4，跳過 setup/install） |
| `games:getImageData(imgPath)` | 讀本地圖片返回 base64 data URL |
| `games:deleteFolder(path)` | 刪除資料夾 |
| `games:deleteFile(path)` | 刪除單一檔案（刪除圖片用） |
| `games:getFolderSize(path)` | 遞迴計算資料夾大小（bytes） |
| `games:uploadImage({gameId, role})` | 上傳圖片；role: `'cover'`/`'listImage'`/`'sample'` |

### 檔案選擇
| 通道 | 說明 |
|------|------|
| `games:selectFile` | 開啟對話框選 exe/壓縮檔，自動偵測路徑中的代碼 |
| `games:selectFolder` | 選擇資料夾 |
| `games:selectExe` | 選擇 exe |
| `games:selectExeFrom(startPath)` | 從指定路徑開啟 exe 選擇對話框 |

### 檔案處理
| 通道 | 說明 |
|------|------|
| `games:previewMove({exePath, gamesDir})` | 預覽移動操作（無代碼時用父目錄） |
| `games:moveToLibrary({exePath, gamesDir})` | 移動遊戲資料夾到 gamesDir（跨磁碟用 copyFileSync） |
| `games:moveFolderToLibrary({srcFolder, gamesDir})` | 直接移動已知資料夾到 gamesDir（掃描資料夾功能用）；目標已存在時回傳 error |
| `games:previewExtract({archivePath, gamesDir})` | 預覽解壓縮目標位置 |
| `games:extractArchive({archivePath, gamesDir})` | 解壓縮（-mcp=932 處理日文 Shift-JIS 檔名） |

### 匯入
| 通道 | 說明 |
|------|------|
| `import:selectDb` | 開啟對話框選 Games.db |
| `import:preview(dbPath)` | 讀取 SQLite 預覽遊戲數量 |
| `import:run({dbPath, skipDuplicates, existingIds})` | 執行匯入，複製圖片，回傳 Game 陣列 |

### 資料位置管理
| 通道 | 說明 |
|------|------|
| `data:getLocationInfo` | 回傳目前資料根目錄、是否攜帶式模式、exe 目錄、AppData 目錄 |
| `data:migrateToPortable` | 將 `data/` 和 `game-images/` 複製到 exe 旁，刪除原始檔，重新啟動（進度透過 `progress:step` 推送） |
| `data:migrateToAppData` | 將攜帶式資料複製回 AppData，刪除 exe 旁資料，重新啟動 |

### 事件（主程式 → renderer）
| 通道 | 說明 |
|------|------|
| `shell:openExternal(url)` | 在系統瀏覽器開啟 URL |
| `shell:openGetchuSearch(keyword)` | 用 iconv-lite 將關鍵字轉 EUC-JP percent-encode 後，開啟 Getchu 搜尋頁（直接 encodeURIComponent 會亂碼） |
| `game:session-end` | 遊戲關閉事件（含遊玩秒數） |
| `progress:step` | 進度更新 `{msg, pct}` |

---

## 主要功能

### 新增遊戲流程（exe）
1. 點「+ 新增遊戲」→ 開啟檔案對話框（exe 或壓縮檔）
2. 自動從路徑偵測 RJ/VJ/BJ 代碼
3. 若**沒有代碼**：顯示手動輸入欄（DLsite 代碼 / Steam App ID / **Getchu ID**），可套用後自動抓取資訊
4. 若**仍無代碼**：自動指派 `NF001`、`NF002`... 遞增
5. 遊戲**標題**：有資訊取官方標題，否則取 exe 的上層資料夾名稱
6. 若有設定 `gamesDir`：
   - exe：移動整個資料夾到 gamesDir（可勾選「不搬移」保留原始路徑）
   - 壓縮檔：解壓縮到 `{gamesDir}/{壓縮檔名}/`
7. 加入完成後自動計算資料夾大小

**Exe 移動邏輯**：往上找含 RJ 代碼的祖先資料夾；找不到則用 exe 的直接上層資料夾。跨磁碟用 `copyFileSync` 逐檔複製（避免 `cpSync` 中文路徑亂碼）。

**解壓縮編碼**：使用 `7za -mcp=932`，正確處理日文 Shift-JIS 編碼的 ZIP 檔名。

### DLsite 爬蟲
- 網址：RJ→`/maniax/`、VJ→`/home/`、BJ→`/boys-love/`
- Cookie：`locale=ja_JP`（日文原文，tags 為日文）
- 標題：去掉 `[社團名]` 後綴和 `| DLsite...` 後綴
- 抓取：og:title、og:image、`.maker_name`、`ジャンル` tags（3 種方式）、`作品形式`、DLsite 評分、`販売日`
- 圖片存到 `game-images/{code}/`（`main.jpg` + `sam.jpg` + `smp1/smp2`...）
- `sam.jpg`：由 cover URL 將 `_img_main` 替換為 `_img_sam` 取得，作為列表縮圖

### Steam 爬蟲
- API：`https://store.steampowered.com/api/appdetails?appids={appId}&l=tchinese`
- 抓取：名稱、開發商、genres、header_image、screenshots（最多 6 張）、發售日
- 圖片存到 `game-images/ST{appId}/`
- 遊戲代碼格式：`ST{appId}`

### Getchu 爬蟲
- URL：`https://www.getchu.com/item/{id}?gc=gc`（`?gc=gc` 直接繞過年齢認証）
- 代碼格式：`GC{id}`（如 `GC1355691`）
- **charset 處理**：使用 `fetchHTMLGetCookies`，自動從 Content-Type header 或 meta 標籤偵測 EUC-JP / Shift-JIS / UTF-8，用 `TextDecoder` 解碼
- **資料來源**：優先解析頁面 `<script type="application/ld+json">` JSON-LD（`Product` 物件）
  - `name` → 標題
  - `brand.name` → 社團
  - `image[0]` → 封面 URL（`c{id}package.jpg`）
  - `image[1..]` → 樣本圖 URL（`c{id}sample{n}.jpg`）
  - Fallback：`<h2 id="soft-title">`、`id="brandsite"` anchor
- **發售日**：從商品 table 的 `発売日：` 欄位解析（`YYYY/M/D` 格式）
- **圖片下載**：
  - 封面用 `rc{id}package.jpg`（resized 版，同時存為 `main.jpg` 和 `sam.jpg`）
  - 樣本圖用 JSON-LD 的 `image[1..]`（`c{id}sample{n}.jpg`）
  - 必須帶 `Referer: https://www.getchu.com/`，否則 403；不可帶 DLsite 的 `locale=zh_TW` cookie
- 圖片存到 `game-images/GC{id}/`（`main.jpg` + `sam.jpg` + `smp1.jpg`...）

### 匯入舊版 GameManager 0.49
- 讀取 SQLite `Games.db`（使用 `sql.js`）
- 欄位對應：RJCode→id、Title→title、Circle→circle、Tags→tags、Comments→note、Rating→rating、Size(KB)→folderSize(bytes) 等
- 圖片複製：`IsListImage=1`→`sam.jpg`、`IsCoverImage=1`→`main.jpg`、其餘→`smp{n}.jpg`
- 遊戲目錄不搬移，只更新路徑

### 批量更新 DLsite 資訊
- 對當前篩選列表中的 DLsite 遊戲（RJ/VJ/BJ）逐筆重新抓取
- 工具列顯示「↻ 批量更新 (N)」按鈕，N 為可更新數量
- 顯示整體進度 + 單筆進度，支援中途停止

### Locale Emulator 啟動
- 遊戲詳情面板的「啟動語系」下拉選單（正常啟動 / 日語 / 繁體中文 / 簡體中文 / 韓語）
- 選擇語系後存入 `game.launchLocale`，下次啟動自動帶入
- 主程式啟動邏輯：`launchLocale` 非空且 `settings.leProcPath` 存在時，改用 `spawn(leProcPath, [exePath])` 啟動
- Locale Emulator 路徑在設定頁（SettingsModal）設定

### 攜帶式模式
- **判斷規則**（packaged）：exe 旁若存在 `data/games.json` 則為攜帶式模式，否則用 AppData
- **開發模式**：優先讀取環境變數 `GAME_DATA_ROOT`（`.env.local` 設定，已加入 .gitignore）；未設定則用專案根目錄
- 設定頁顯示當前模式（攜帶式/AppData badge）和實際路徑
- 搬移按鈕：複製 `data/` 和 `game-images/` 到目標位置 → 刪除來源 → `app.relaunch()` 重啟，全程顯示進度條

### 分頁
- 底部分頁欄：選擇每頁顯示數量（50 / 100 / 250 / 500 / 1000 / 全部）
- 全部（null）= 不分頁，顯示所有篩選結果
- 分頁大小持久化至 `ui-settings.json`（key: `pageSize`）
- 切換篩選條件或分頁大小時自動重置到第 1 頁
- 磁磚視圖和列表視圖共用同一分頁狀態
- **切換分頁時列表自動捲回頂端**（透過 `scrollKey={currentPage}` prop 觸發）

### 遊玩時間計算
- `spawn` 啟動遊戲（detached，保留 close 事件）
- 關閉時發送 `game:session-end`，renderer 累加 `playTime`
- 啟動/關閉錯誤記錄到 logs/

### 錯誤日誌
- 位置：`{appRoot}/logs/YYYY-MM-DD.log`（每天一檔）
- 自動清除 3 天前的舊 log

---

## UI 元件說明

### Sidebar（左側）
- 遊戲數量顯示
- 我的最愛篩選
- **來源篩選**（可收合）：DLsite 遊戲 / Steam 遊戲 / Getchu 遊戲 / 其他遊戲
- **評分篩選**（可收合）：0-5 星以上
- **標籤過濾**：多選（AND 邏輯）+ 關鍵字搜尋
  - 各標籤 hover 顯示 ★ 按鈕，點擊標為「最愛標籤」永久置頂
  - 排序：最愛已選 → 最愛未選 → 一般已選 → 一般未選；最愛與非最愛間有分隔線
  - 最愛標籤持久化至 `ui-settings.json`（key: `favoriteTags`）
- 所有篩選狀態和收合狀態持久化

### GameGrid（磁磚視圖）
- 16:9 比例卡片
- Toolbar 有排序選單（與列表欄位相同）+ ASC/DESC 切換
- 排序設定持久化

### GameList（列表視圖）
- **列表縮圖**：每行最左固定 32px 縮圖欄；fallback 順序：listImage → cover（本地）→ 遠端 `_img_sam` URL
- 動態欄位（右鍵標題列選擇，含大小、遊玩時間等欄位）
- 欄位可拖拉調整寬度、拖拉換順序
- 點擊欄位標題排序（無→▲→▼→無）；空值永遠排最後
- **分組顯示**：Toolbar 分組下拉選單（社團/評分/作品形式/來源/發售年份/各月份選項）
- **日期欄位自動分組**：點擊加入時間/發售日/上次遊玩排序時，自動套用對應月份分組
- 滑鼠停留 300ms 顯示封面圖預覽；移到預覽圖上可滾輪切換圖片（背景列表不捲動）
- **鍵盤導覽**：
  - ↑↓ 切換上/下一款（在當前分頁內），列表自動捲動確保選中行可見（`scrollIntoView({ block: 'nearest' })`，`data-uuid` 定位 DOM）
  - Enter 啟動選中遊戲（輸入框內不觸發）
- 雙擊啟動遊戲
- 所有欄位/排序/分組/寬度設定持久化

### GameDetail（右側面板）
- 可拖拉左邊緣調整寬度（220~600px），持久化
- **代碼可編輯**（點擊），標題可編輯（點擊）
- **↻ 重新抓取資訊**（DLsite/Steam/Getchu 遊戲），顯示進度條
- **圖片預覽**：最大高度 420px，超高圖片自動縮限（`object-fit: contain`）
- **圖片管理**：
  - DLsite/其他：index 0=封面, 1=列表縮圖（有「縮圖」badge）, 2+=樣本圖
  - Steam：index 0=封面, 1+=樣本圖（無列表縮圖 slot）
  - ✎ 進入編輯模式 → 每張圖片顯示 × 可刪除
  - 封面/縮圖 hover 顯示上傳按鈕
  - 縮圖列末端有 + 上傳樣本圖
- 圖片點擊開啟燈箱（鍵盤/滾輪切換、Esc 關閉）
- **← → 方向鍵**切換預覽圖（`activeIdx` 循環）；輸入框內不觸發
- Tag 編輯模式（✎ → × 移除 + 新增輸入框 + 自動補全）
- 我的最愛切換（♡/♥）、DLsite ↗ / Steam ↗ / Getchu ↗ 連結（依代碼前綴顯示對應來源）
- **↻ 重新抓取**支援 DLsite（RJ/VJ/BJ）、Steam（ST）、Getchu（GC）
- **🖼 圖片資料夾**：有本地圖片時顯示，開啟存放圖片的資料夾
- ⚙ 啟動檔案設定、**啟動語系**下拉選單（Locale Emulator）、備注編輯 + 儲存
- 統計：發售日、DLsite 評分、加入時間、遊玩次數、遊玩時間、上次遊玩、磁碟大小（含 ↻）

### 右鍵選單（GameContextMenu）
- 開啟遊戲 / DLsite 頁面 / Steam 頁面 / Getchu 頁面 / 開啟遊戲資料夾
- 依社團搜尋 / 依代碼搜尋
- 從列表移除 / 移除並刪除檔案
- **推薦搜尋**（僅限「其他遊戲」類型，即非 RJ/ST/GC 的遊戲）：
  - 🔎 DLsite 搜尋（廣域）— 開啟 DLsite 全品類搜尋頁
  - ⬇ 嘗試更新 DLsite 資訊 — 呼叫 `games:suggestFetchDlsite`，成功後自動更新遊戲資料（含 ID 變更為 RJ 代碼）；結果顯示 toast 通知
  - 🔎 Steam 搜尋 — 開啟 Steam 搜尋頁
  - 🔎 Getchu 搜尋 — 呼叫 `shell:openGetchuSearch`（EUC-JP 編碼）

### AddGameModal（新增遊戲）
- 自動偵測代碼，顯示 DLsite/Steam 資訊預覽
- 無代碼時：顯示 DLsite 代碼 / Steam App ID / **Getchu ID** 手動輸入欄
- exe 加入時：「不搬移資料夾」選項
- 顯示移動/解壓縮預覽路徑，進度條

### DuplicateModal（重複偵測）
- 標題列「重複偵測」按鈕開啟（有遊戲時顯示）
- 依 `game.id` 找出重複群組，checkbox 選取要移除的條目

### BatchFetchModal（批量更新）
- 工具列「↻ 批量更新 (N)」按鈕（列表中有 DLsite 遊戲時顯示）
- 依序抓取，整體進度 + 單筆進度，可中途停止

### ScanFolderModal（掃描資料夾）
- 標題列「掃描資料夾」按鈕開啟
- **流程**：選擇資料夾 → 掃描 → 預覽列表 → 勾選 → 加入
- 掃描目標資料夾的直接子資料夾，每個子資料夾視為一款遊戲
- 從資料夾名稱偵測 RJ/VJ/BJ（DLsite）、ST（Steam）、GC（Getchu）代碼
- 遞迴搜尋 exe（深度 ≤ 4，跳過 setup/install 等）
- **類型過濾**：DLsite / Steam / 其他 三個切換按鈕（含各類型數量），可組合篩選顯示
- 「已在庫中」判斷：代碼重複或資料夾路徑已存在；預設不勾選、半透明顯示
- 勾選介面：全選未入庫 / 全選 / 全不選（僅作用於目前可見項目）
- **移動選項**：若已設定 `gamesDir`，顯示「移動到遊戲資料夾」勾選框，打勾後加入時先移動資料夾再抓資訊
- 加入時：DLsite→自動抓取、Steam→Steam API、Getchu→fetchGetchuInfo、無代碼→指派 NF 代碼
- 顯示整體進度 + 單筆進度，支援中途停止

### ImportModal（匯入舊版）
- 標題列「匯入舊版」按鈕
- 選擇 Games.db → 預覽數量 → 執行匯入，自動複製圖片

### SettingsModal（設定）
- 選擇 `gamesDir`（遊戲儲存目錄）
- 選擇 `leProcPath`（LEProc.exe 路徑），用於 Locale Emulator 啟動
- **資料儲存位置**：顯示當前模式 badge（攜帶式/AppData）和路徑，提供一鍵搬移按鈕（附進度條）

---

## 視窗行為

- 啟動時讀取上次視窗大小（`ui-settings.json`）
- 視窗大小改變後 500ms 自動存檔
- 最小寬度 800px、最小高度 600px

---

## 已知注意事項

1. **uuid 是真正的主鍵**，`id` 只是屬性，可重複。舊 JSON 無 uuid 欄位，載入時自動生成。
2. **圖片路徑**存相對路徑，搬移或改名專案目錄後圖片仍可正常顯示。
3. **DLsite 爬蟲依賴 HTML 結構**，若 DLsite 改版需更新 main/index.ts 的 regex。
4. **跨磁碟移動**用 `copyFileSync` 逐檔複製（非 `cpSync`），避免中文路徑亂碼。
5. **ZIP 解壓縮**加 `-mcp=932`，處理日文 Shift-JIS 編碼的傳統 ZIP 檔名。
6. **遊玩時間**：若 Electron 在遊戲關閉前強制退出，該次時間不會記錄。
7. **啟動 workaround**：main/index.ts 最頂端的 `process.stdout.write('')` 提供 event loop tick，避免特定環境的 Chromium GPU 初始化 race condition 崩潰，請勿移除。
8. **列表分組+排序**：分組排序方向與欄位排序方向一致；空值群組（從未遊玩/未知日期等）永遠排最後。
9. **Hover preview 滾輪**：使用 callback ref + `addEventListener('wheel', ..., { passive: false })` 阻止背景捲動，不可用 React `onWheel`（passive 限制）。
10. **攜帶式模式判斷**（packaged）：`getAppRoot()` 檢查 exe 旁是否有 `data/games.json`，有則用 exe 目錄，否則用 AppData；搬移後 `app.relaunch()` 重啟讓新路徑生效。
11. **Steam 遊戲無 listImage**：`listImage` 欄位只給 DLsite/其他遊戲使用；Steam 遊戲的列表縮圖改用 `cover`（main.jpg），詳情面板圖片索引也不含 listImage slot。
12. **Locale Emulator**：`leProcPath` 為空或 `launchLocale` 為 null 時正常啟動，不呼叫 LE；LE 不支援的語系直接在 select 選項控制，不需額外判斷。
13. **Getchu 年齢認証**：URL 加 `?gc=gc` 即可直接繞過，伺服器回傳 `getchu_adalt_flag=getchu.com` cookie 並直接給商品頁。不需要複雜的 cookie 流程。
14. **Getchu 圖片 403**：圖片伺服器要求 `Referer: https://www.getchu.com/`，缺少會 403；DLsite 的 `Cookie: locale=zh_TW` 送給 Getchu 也會 403，兩者不可混用。`downloadImage` 函數簽名：`(url, dest, redirectCount=0, cookie='locale=zh_TW', referer='')`，Getchu 呼叫時傳 `cookie=''、referer='https://www.getchu.com/'`。
15. **dev 模式資料路徑**：優先讀取 `GAME_DATA_ROOT` 環境變數（`.env*.local` 設定，已加入 .gitignore）；`.env.local` 指向 AppData（測試環境），`.env.prod.local` 指向 `G:/GameManager`（正式環境），用 `npm run dev:prod` 切換。
16. **log 路徑**：`logDir` 只在 `logError()` 被觸發時才建立，沒有錯誤就不會有 log 目錄。dev 模式下 log 位於 `{GAME_DATA_ROOT}/logs/`。
17. **DLsite suggest API**：回傳格式為 `cb({"work":[{"workno":"RJ...","work_name":"...","maker_name":"..."}]})` 的 JSONP；解析時不依賴 callback 名稱，直接找第一個 `(` 和最後一個 `)` 取 JSON 內容。
18. **Getchu 搜尋 URL 編碼**：Getchu 服務器按 EUC-JP 解讀 query string，UTF-8 的 `encodeURIComponent` 會造成亂碼；須用 `iconv-lite` 將關鍵字轉 EUC-JP bytes 再逐 byte percent-encode。
19. **GameCard React.memo**：GameCard 包了 `React.memo`，避免父元件重繪時不必要的卡片重新渲染。
20. **列表排序順序**：排序在 `App.tsx` 用 `sortListGames()`（`utils.ts`）完成後再分頁，確保跨頁排序正確；`GameList` 的 `sortKey`/`sortDir` 是受控 props，點擊欄位標題呼叫 `onSortChange` 回調。
21. **launchGame 語系**：`launchGame` 呼叫時帶 `locale: game.launchLocale ?? undefined`，主程式判斷是否用 Locale Emulator 啟動；任何入口（雙擊、Enter、右鍵選單）皆生效。

---

## 指令

```bash
npm run dev          # 開發模式，讀取 AppData 資料（.env.local）
npm run dev:prod     # 開發模式，讀取 G:\GameManager 資料（.env.prod.local）
npm run typecheck    # TypeScript 型別檢查
npm run build:win    # 建置 Windows zip（不產出安裝檔）
```
