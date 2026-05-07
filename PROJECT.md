# DLsite Manager v2 — 專案說明文件

## 概覽

Windows 桌面應用程式，功能類似 Steam，用來管理 DLsite 遊戲庫。  
技術棧：**Electron 39 + electron-vite + React 19 + TypeScript**

---

## 目錄結構

```
dlsite-manager-v2/
├── src/
│   ├── main/index.ts          ← Electron 主程式（IPC handlers、爬蟲、檔案操作）
│   ├── preload/index.ts       ← contextBridge 暴露 API
│   └── renderer/src/
│       ├── App.tsx            ← 主程式入口、狀態管理
│       ├── App.css            ← 全域深色主題樣式
│       ├── types.ts           ← 型別定義（Game、ColumnDef、ALL_COLUMNS 等）
│       ├── electron.d.ts      ← window.electronAPI 型別宣告
│       ├── utils.ts           ← localDateTime / formatPlayTime / generateUUID
│       └── components/
│           ├── Sidebar.tsx        ← 左側篩選欄（我的最愛、評分、標籤多選）
│           ├── GameGrid.tsx       ← 磁磚瀏覽容器
│           ├── GameCard.tsx       ← 磁磚卡片
│           ├── GameList.tsx       ← 列表瀏覽（可排序、可調欄寬、hover 預覽）
│           ├── GameDetail.tsx     ← 右側詳情面板（可拉寬）
│           ├── ImageLightbox.tsx  ← 圖片燈箱（鍵盤/滾輪切換）
│           ├── GameContextMenu.tsx← 右鍵選單
│           ├── AddGameModal.tsx   ← 新增遊戲（自動偵測代碼、進度條）
│           ├── ScanModal.tsx      ← 批量掃描資料夾
│           └── SettingsModal.tsx  ← 設定（遊戲儲存目錄）
├── data/
│   ├── games.json             ← 遊戲資料庫
│   └── settings.json          ← 使用者設定
├── game-images/               ← 封面圖快取（每款遊戲獨立子資料夾）
│   └── {code}/
│       ├── main.jpg           ← 主封面
│       ├── smp1.webp          ← 樣本圖 1
│       └── smp2.webp ...
└── PROJECT.md                 ← 本文件
```

---

## 資料模型（Game）

```typescript
interface Game {
  uuid: string          // 唯一識別碼（自動生成，永不重複，作為真正的主鍵）
  id: string            // 遊戲代碼（RJ/VJ/BJ），純屬性，可重複
  title: string
  circle: string        // 社團名
  tags: string[]
  cover: string | null  // 本地封面圖路徑（game-images/{code}/main.jpg）
  coverUrl: string | null  // 遠端封面 URL
  sampleImages: string[]   // 樣本圖本地路徑陣列
  path: string | null   // 遊戲資料夾路徑
  exe: string | null    // 啟動 exe 路徑
  rating: number        // 個人評分 0-5
  note: string
  addedAt: string       // 加入時間（YYYY-MM-DD HH:MM:SS）
  language: string
  releaseDate: string | null   // DLsite 發售日
  workType: string | null      // 作品形式（シミュレーション 等）
  dlsiteRating: string | null  // DLsite 社群評分
  lastPlayedAt: string | null  // 上次遊玩時間
  playCount: number            // 遊玩次數
  playTime: number             // 累積遊玩時間（秒）
  isFavorite: boolean          // 我的最愛
}
```

> **重要**：所有身份比對（updateGame、deleteGame、React key、selected 狀態）一律使用 `uuid`，不使用 `id`（遊戲代碼）。

---

## 設定（settings.json）

```json
{ "gamesDir": "D:/Games" }
```

- `gamesDir`：新增遊戲時，遊戲資料夾移動/解壓縮的目標目錄
- 透過 ⚙ 設定按鈕修改

---

## IPC 通道（主程式 ↔ renderer）

### 設定
| 通道 | 說明 |
|------|------|
| `settings:load` | 讀取 settings.json |
| `settings:save` | 儲存 settings.json |

### 遊戲資料
| 通道 | 說明 |
|------|------|
| `games:load` | 讀取 games.json（自動補舊版缺少的欄位） |
| `games:save` | 儲存 games.json |
| `games:fetchInfo(code)` | 從 DLsite 抓取資訊（標題/社團/tag/評分/發售日/圖片） |
| `games:extractCode(str)` | 從字串擷取 RJ/VJ/BJ 代碼 |

### 遊戲操作
| 通道 | 說明 |
|------|------|
| `games:launch({exePath, gameId})` | spawn 啟動 exe（detached，計時） |
| `games:openFolder(path)` | shell.openPath 開啟資料夾 |
| `games:findExe(folderPath)` | 在資料夾內搜尋 exe（深度≤4，跳過 setup/install） |
| `games:getImageData(imgPath)` | 讀本地圖片返回 base64 data URL |
| `games:deleteFolder(path)` | fs.rm 刪除資料夾 |

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
| `games:previewMove({exePath, gamesDir})` | 預覽 exe 移動操作（找到含代碼的祖先資料夾） |
| `games:moveToLibrary({exePath, gamesDir})` | 實際移動遊戲資料夾到 gamesDir |
| `games:previewExtract({archivePath, gamesDir})` | 預覽解壓縮目標位置 |
| `games:extractArchive({archivePath, gamesDir})` | 解壓縮到 `{gamesDir}/{壓縮檔名}/` |
| `games:scanFolder(folderPath)` | 掃描資料夾，找出含 RJ 代碼的子資料夾 |

### 其他
| 通道 | 說明 |
|------|------|
| `shell:openExternal(url)` | 在系統瀏覽器開啟 URL |
| `game:session-end` | 主程式→renderer：遊戲關閉事件（含遊玩秒數） |
| `progress:step` | 主程式→renderer：進度更新 `{msg, pct}` |

---

## 主要功能

### 新增遊戲流程
1. 點「+ 新增遊戲」→ **直接開啟檔案對話框**（exe 或壓縮檔）
2. 自動從路徑偵測 RJ/VJ/BJ 代碼
3. 若找到代碼 → 自動抓 DLsite 資訊（標題/社團/tag/評分/發售日/所有圖片）
4. 顯示進度條（百分比）
5. 若有設定 `gamesDir`：自動移動/解壓縮到目標目錄

**解壓縮邏輯**：目標資料夾名稱 = 壓縮檔名（不含副檔名），內容解壓至其中。

**Exe 移動邏輯**：往上找含 RJ 代碼的祖先資料夾，整個移動，跨磁碟自動改用 copy+delete。

### DLsite 爬蟲
- 網址：RJ→`/maniax/`、VJ→`/home/`、BJ→`/boys-love/`
- Cookie：`locale=zh_TW`（繁體中文）
- 抓取：og:title、og:image、`.maker_name`、`ジャンル` table row、`作品形式` table row、DLsite 評分
- 圖片存到 `game-images/{code}/`（main + smp1/smp2...）

### 遊玩時間計算
- `spawn` 啟動遊戲（detached，保留 close 事件監聽）
- 遊戲關閉時發送 `game:session-end`，renderer 累加 `playTime`

---

## UI 元件說明

### Sidebar（左側）
- 遊戲數量顯示
- 我的最愛篩選
- 評分篩選（0-5 星以上）
- 標籤多選（AND 邏輯）+ 關鍵字過濾 + 已選置頂 + 捲軸

### GameList（列表視圖）
- 動態欄位（右鍵標題列選擇顯示欄位）
- 欄位可拖拉調整寬度（儲存到 localStorage）
- 欄位可拖拉換順序
- 點擊欄位標題排序（無→▲→▼→無，儲存到 localStorage）
- 整體表格橫向捲動
- 滑鼠停留 300ms 顯示封面圖預覽（優先讀本地圖片）
- 雙擊啟動遊戲

### GameDetail（右側面板）
- 可拖拉左邊緣調整寬度（220~600px，儲存到 localStorage）
- 圖片點擊開啟燈箱（鍵盤/滾輪切換、Esc 關閉）
- 縮圖列（sampleImages）
- Tag 編輯模式（點 ✎ → 顯示 × 移除鈕 + 新增輸入框 + 自動補全）
- 我的最愛切換（♡/♥）
- ⚙ 啟動檔案設定（從當前 exe 目錄開啟選擇對話框）
- 儲存時包含 note、rating、tags
- 統計：發售日、DLsite 評分、加入時間、遊玩次數、遊玩時間、上次遊玩

### 右鍵選單（GameContextMenu）
- 開啟遊戲 / DLsite 頁面 / 開啟資料夾
- 依社團搜尋 / 依代碼搜尋
- 從列表移除 / 移除並刪除檔案

---

## 視圖模式 & 持久化設定

所有存入 `localStorage`：

| key | 說明 |
|-----|------|
| `viewMode` | `'grid'` 或 `'list'` |
| `listColumns` | 可見欄位的 key 陣列（有序） |
| `listColWidths` | 欄寬 `{key: px}` |
| `listSortKey` | 目前排序欄位 |
| `listSortDir` | `'asc'` / `'desc'` |
| `detailWidth` | 右側面板寬度（px） |

---

## 已知注意事項

1. **uuid 是真正的主鍵**，`id`（遊戲代碼）只是屬性，可重複。舊版 JSON 無 uuid 欄位，載入時自動生成。
2. **圖片目錄**：`{appRoot}/game-images/{code}/`（dev: 專案根目錄；prod: userData）
3. **DLsite 爬蟲依賴 HTML 結構**，若 DLsite 改版需更新 main/index.ts 的 regex
4. **作品形式**：從 `work_outline` table 找 `作品形式` 那列，用 `</tr>` 分割後掃描
5. **7zip-bin**：已作為 electron-builder 依賴存在，無需另外安裝
6. **遊玩時間計時**：若 Electron 在遊戲關閉前被強制退出，該次時間不會記錄
