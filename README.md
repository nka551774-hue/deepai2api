# deepai2api

> 管理面板參考 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) 的版面與操作流程，繼續使用 DeepAI 上游。
> 參考版本與 MIT 授權見 `THIRD_PARTY_NOTICES.md`。

將 [deepai.org](https://deepai.org/chat) 的 AI Chat 反向代理成 **OpenAI 相容 API**,附帶多帳號池(帳號池輪替)與 Web 管理面板。零執行期依賴(純 Node.js 18+),支援 Docker 一鍵部署。

```
deepai.org chat ──反代──> deepai2api ──OpenAI 格式──> 任何 OpenAI 用戶端
                          (帳號池 / 金鑰輪替 / 台面儀表板)
```

## 功能

- **OpenAI 相容 API**
  - `GET  /v1/models`
  - `POST /v1/chat/completions`(支援 `stream: true`,reasoning 模型的思維鏈會以 `reasoning_content` delta 串流輸出)
  - `POST /v1/images/generations`(對接上游內建生圖工具 / `/api/text2img`)
- **上游帳號池**：依帳號權重與使用次數輪替，同一對話優先沿用原帳號。配額耗盡時冷卻，憑證失效時嘗試重登或停用。支援三種帳號類型：
  - **Cookie 匯入**:登入 deepai.org 後,從 DevTools 複製 `api.deepai.org` 任一請求的整行 `cookie:` 貼進面板即可
  - **Email 帳密**:面板填帳密,閘道走官網同款登入流程自動登入、保管 session、過期自動重登
  - **API Key(舊模式)**:deepai dashboard 的持久金鑰
- **匿名 fallback**:池空時自動鑄造單次 `tryit-` 匿名金鑰模擬瀏覽器訪客(每請求以 UA 雜湊重新鑄造,與瀏覽器一致)
- **對話一致性**:同一對話自動黏住同一把上游 key 與 session uuid
- **持久化**:狀態(JSON)寫入 `data/state.json`,原子寫入、重啟不丟失
- **完整帳號管理**:Cookie／帳密／API Key、搜尋篩選與分頁、備註與分組、權重調度、批次測試／重登／啟停／重設、JSON 匯入匯出。環境變數預載與匯入均去重。
- **分類設定**:基礎、API、模型、穩定性及日誌系統分組；主題、介面語言、可見頁籤、區塊限高與刷新間隔。
- **下游權限**:API Key 可限制模型（支援 `*` 萬用字元）、上游帳號白名單及請求上限；並發請求也會預先計數，失敗請求同樣計入上限。

## 快速開始（Docker Compose）

複製 `.env.example` 為 `.env`，修改 `ADMIN_PASSWORD`，再啟動：

```bash
cd 2api
cp .env.example .env
# 編輯 .env，設定自己的 ADMIN_PASSWORD
docker compose up -d --build
```

Windows PowerShell 的複製指令是 `Copy-Item .env.example .env`。既有部署若已有 `.env`，直接編輯原檔。

使用 GHCR 預建映像：

```bash
docker compose pull
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100
```

推送到 `main` 後，CI 會先跑離線測試與容器驗證，再發布 `linux/amd64`、`linux/arm64` 映像。除了 `latest`，也會產生 `sha-…` 標籤；可在 `.env` 的 `IMAGE` 指定固定標籤後執行相同更新指令。

帳號、金鑰和面板設定仍存放在 `./data/state.json`，升級沿用原有資料。啟動時會修正資料夾及兩個狀態檔的擁有者，再以 `app` 使用者執行 Node；不會遞迴改動其他檔案。備份時先執行 `docker compose stop`，複製 `data` 資料夾，再以 `docker compose start` 啟動。

`.env` 的 `PUBLISH_PORT` 控制主機對外埠，`BIND_ADDRESS` 控制主機監聽位址；容器內固定使用 3737。`TZ` 預設為 `Asia/Taipei`。Compose 會載入 `.env`，直接 `npm start` 則使用目前程序的環境變數。

- 面板:<http://localhost:3737/>(密碼取自 `ADMIN_PASSWORD`,預設 `deepai2api`)
- API base:`http://localhost:3737/v1`

Windows 本機啟動（PowerShell，建議 Node.js 24；保留 Node.js 18 相容性測試）：

```powershell
Set-Location 'C:\Users\User\Desktop\2api'
$env:ADMIN_PASSWORD = '請換成自己的密碼'
npm start
```

開啟 `http://localhost:3737/`，使用設定的面板密碼登入。若曾在面板內改密碼，請用儲存後的新密碼。

離線驗證（無需帳號、無需安裝套件）：

```bash
npm test
```

測試使用隔離狀態目錄與本機模擬上游。它們不代表真實 DeepAI 登入、生圖或上游風控已通過。

Docker 容器驗證（需已啟動 Docker Engine；會建立並清除獨立的測試容器與 volume）：

```bash
docker build -t deepai2api:verify .
node scripts/docker-smoke.js deepai2api:verify
```

檢查內容包含健康檢查、靜態資源、非 root 程序、時區、帳號／金鑰／設定的重啟持久化及正常停止。

## 加入帳號到池(擇一)

deepai.org 的 chat **沒有持有式的 API key**:瀏覽器永遠只帶每次新生成的單次 `tryit` key(`api-key` header)+ 登入 session cookie(`credentials: include`)。帳號身份 = cookie。所以池以「帳號」為單位:

1. **匿名模式(零設定)**:池留空 + `ALLOW_ANONYMOUS_FALLBACK=true`,閘道每個請求自動鑄造匿名單次 `tryit` key 模擬訪客。免登入但可能被上游風控。
2. **Cookie 匯入**：登入 deepai.org → F12 → Network → 選取 `api.deepai.org` 的請求 → Request Headers → 複製 `cookie:` → 面板「帳號 → 新增帳號 → Cookie」貼上，每行一個帳號。
3. **Email 帳密**：面板「帳號 → 新增帳號 → 帳號密碼」輸入 DeepAI Email 和密碼。閘道儲存工作階段，Cookie 失效時會嘗試重登。
4. **API Key（舊模式）**：在新增帳號時選 API Key，填入 DeepAI 的持久金鑰。也可透過 `UPSTREAM_KEYS` 或 `ACCOUNT_COOKIES` 環境變數預載。

> 本專案僅供協定學習與個人研究,請遵守上游服務條款;請勿使用主帳號、勿商業轉售。上游隨時可能收緊風控,使用造成的任何後果自負。

## API 用法

```bash
curl -N http://localhost:3737/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-deepai-..." \
  -d '{"model":"deepai-standard","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

Python(OpenAI SDK):

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3737/v1", api_key="sk-deepai-...")
r = client.chat.completions.create(
    model="deepai-standard",
    messages=[{"role": "user", "content": "你好"}],
    stream=True,
)
for chunk in r:
    print(chunk.choices[0].delta.content or "", end="")
```

### 模型

對外模型名稱預設映射如下(可在面板「設定」中自訂 JSON):

| 對外模型 | 上游 model |
| --- | --- |
| `deepai-standard` | `standard`(免費檔位) |
| `deepai-genius` | `genius`(需帳號有權限) |
| `deepai-super-genius` | `super_genius`(推理檔,thinking 模式) |
| `gpt-4o-mini` | `standard` |
| 其他名稱 | 直通(passthrough,可在設定關閉) |

未簽發任何 API 金鑰前,`/v1/*` 為開放模式(`ALLOW_OPEN_WHEN_NO_KEYS=true` 時);在面板簽發第一把 `sk-deepai-…` 後,所有請求都必須攜帶金鑰。

`/v1/models` 同樣驗證金鑰並依模型白名單過濾。設定帳號白名單的 Key 只可調度指定帳號，帳號全數不可用時會回報錯誤，不會改用匿名訪客。

多輪對話預設以第一則使用者訊息、前置系統訊息、模型及下游 Key 推導識別。若同一 Key 會同時處理多個相同開場的對話，請在每一輪傳入不同且固定的 `session_key`，避免它們被視為同一對話。不同 Key 的識別彼此隔離。

## 管理面板

| 頁籤 | 功能 |
| --- | --- |
| 總覽 | 請求量、錯誤率、輸出字元、模型統計、上游池健康 |
| 閘道 | API 位址、對話和生圖端點、模型目錄 |
| 帳號 | 新增與篩選、分組和權重、批次操作、JSON 備份與還原 |
| 分析 | 今日、近 7 天及近 30 天的請求量、模型與金鑰用量 |
| 日誌 | 搜尋請求紀錄，查看模型、狀態、耗時及錯誤 |
| 設定 | 簽發及管理下游金鑰、模型映射、請求逾時、密碼與介面偏好 |

面板設定會持久化並優先於對應環境預設值；匿名回退、首次開放模式及日誌筆數可在設定中修改。模型映射、超時與數值範圍會在儲存前驗證，錯誤輸入不會部分套用。

匯出的帳號 JSON 含登入憑證；請妥善保管。清單 API 不回傳完整上游憑證。修改面板密碼需提供目前密碼，其他已登入工作階段隨即失效。

若現有 `state.json` 損毀或無法讀取，服務會停止啟動並保留原檔，避免以空帳號和開放模式覆寫資料。

## 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3737` | 服務埠 |
| `ADMIN_PASSWORD` | `deepai2api` | 面板登入密碼(請務必修改) |
| `DATA_DIR` | `./data` | 狀態檔目錄 |
| `ALLOW_ANONYMOUS_FALLBACK` | `true` | 池空時自動用匿名 tryit key |
| `ALLOW_OPEN_WHEN_NO_KEYS` | `true` | 未簽發 API 金鑰前 API 開放 |
| `UPSTREAM_TIMEOUT_MS` | `180000` | 上游單請求超時 |
| `UPSTREAM_KEYS` | — | 開機時匯入的舊模式 key(逗號分隔) |
| `ACCOUNT_COOKIES` | — | 開機預載的瀏覽器 Cookie 帳號(換行分隔多個) |

## 專案結構

```
2api/
├── server.js              # HTTP 主體 + 路由
├── src/
│   ├── config.js          # 環境變數設定
│   ├── store.js           # JSON 持久化(原子寫、防抖)
│   ├── islandHash.js      # tryit 匿名 key 鑄造(上游 UA 雜湊)
│   ├── streamParser.js    # 上游串流封包解析
│   ├── deepai.js          # 上游 client(browser dialect + 登入)
│   ├── accountPool.js     # 帳號池輪替 + 自動重登 + failover
│   ├── auth.js            # 面板 session / API 金鑰
│   ├── openaiRoutes.js    # /v1/* OpenAI 相容層
│   └── adminRoutes.js    # /api/admin/* 面板後端
├── public/                # 面板前端(無 build step)
├── Dockerfile
└── docker-compose.yml
```

## 注意事項

- 匿名 `tryit-` key 的十六進位部分是對 User-Agent 的確定性雜湊、且**單次使用**;修改 `UPSTREAM_USER_AGENT` 需與 key 鑄造一致(本專案已自動處理)。
- 客戶端要求 ─ 重新導向之間:閘道每對話(依使用者訊息內容雜湊)固定黏住同一把上游 key;上游對 session 有記憶,多輪對話能保持上下文。
- 若上游對非瀏覽器 TLS 堆疤回「Please try this model on deepai.org」,錯誤會以 `UPSTREAM_REJECTED` 記錄,並自動換 key 重試。
