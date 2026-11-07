# deepai2api

> 面板 UI 改编自 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub)(MIT License,© ardeyouxipianyi)——登录闸门 / 侧边导航
> (总览·网关·账号·分析·日志·设置)/ 组件样式原样沿用,数据层对接本网关的 DeepAI 账号池。

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
- **上游帳號池(workbuddy 式)**:多帳號輪替、LRU 排程、同一對話黏住同一帳號、配額自動冷卻、錯誤自動停用、單鍵測試。三種帳號型態:
  - **Cookie 匯入**:登入 deepai.org 後,從 DevTools 複製 `api.deepai.org` 任一請求的整行 `cookie:` 貼進面板即可
  - **Email 帳密**:面板填帳密,閘道走官網同款登入流程自動登入、保管 session、過期自動重登
  - **API Key(舊模式)**:deepai dashboard 的持久金鑰
- **匿名 fallback**:池空時自動鑄造單次 `tryit-` 匿名金鑰模擬瀏覽器訪客(每請求以 UA 雜湊重新鑄造,與瀏覽器一致)
- **Web 管理面板**:登入保護、總覽統計、帳號池管理(Cookie/帳密)、下游 API 金鑰簽發(可限制模型白名單 / 請求上限)、請求日誌、模型映射設定
- **對話一致性**:同一對話自動黏住同一把上游 key 與 session uuid
- **持久化**:狀態(JSON)寫入 `data/state.json`,原子寫入、重啟不丟失

## 快速開始(Docker)

```bash
cd 2api
docker compose up -d --build
```

- 面板:<http://localhost:3737/>(密碼取自 `ADMIN_PASSWORD`,預設 `deepai2api`)
- API base:`http://localhost:3737/v1`

本機直接跑(需 Node.js 18+):

```bash
node server.js
```

## 加入帳號到池(擇一)

deepai.org 的 chat **沒有持有式的 API key**:瀏覽器永遠只帶每次新生成的單次 `tryit` key(`api-key` header)+ 登入 session cookie(`credentials: include`)。帳號身份 = cookie。所以池以「帳號」為單位:

1. **匿名模式(零設定)**:池留空 + `ALLOW_ANONYMOUS_FALLBACK=true`,閘道每個請求自動鑄造匿名單次 `tryit` key 模擬訪客。免登入但可能被上游風控。
2. **Cookie 匯入(建議)**:登入 deepai.org → F12 → Network → 隨便點一個 `api.deepai.org` 的請求 → Request Headers → 複製整行 `cookie:` → 面板「帳號池 → 瀏覽器 Cookie 匯入」貼上。可多行(一行一個帳號)。
3. **Email 帳密**:面板填 deepai.org 的 Email + 密碼,閘道以官網同款流程(`POST /daily-time-sync/login/`)自動登入並保管 session,cookie 過期自動重登。
4. **API Key(舊模式)**:deepai dashboard 的持久金鑰,`UPSTREAM_KEYS` 環境變數或 `ACCOUNT_COOKIES`(每行一個 cookie)也可開機預載。

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

## 管理面板

| 頁籤 | 功能 |
| --- | --- |
| 總覽 | 請求量、錯誤率、輸出字元、模型統計、上游池健康 |
| 帳號池 | 匯入 Cookie / 帳密登入、啟停/重登/測試、冷卻與錯誤一覽 |
| API 金鑰 | 簽發給下游的 `sk-deepai-…`,模型白名單與請求上限 |
| 請求日誌 | 最近 500 筆請求(模型、金鑰、狀態、耗時、預覽/錯誤) |
| 設定 | 預設模型、模型映射 JSON、上游超時 |

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
