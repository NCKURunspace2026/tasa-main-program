# Mission Dashboard

軌道競賽的 Electron + React Client 與 FastAPI 中央 Server。Client 使用本機 General Mission Analysis Tool (GMAT) 做提交前驗證；中央 Server 的 SQLite `main.db` 是唯一正式資料來源。

## 架構

```text
React UI → Electron IPC → Local GMAT
    │                         │
    └──── passed evidence ────┘
                ↓
        FastAPI Cloud Relay → Central FastAPI → Service → Repository → SQLite main.db
                                      ↓
                         Electron Server Validation Worker
                                      ↓
                              Central GMAT Console
                                      ↓
                              passed Leaderboard
```

後端只保留三個正式實體：

- `Scenario`：固定題目、物理模型、座標系、積分器、驗證與計分參數。
- `Solution`：使用者名稱與 Decision Variables。
- `Submission`：Client 驗證證據、中央 Queue 狀態與正式結果。

Leaderboard 是 `passed` Submission 的查詢結果，不另建資料表。

中央 Worker 透過受 token 保護的 internal API claim `pending` Submission，執行中央 GMAT，再由 FastAPI 的 ScoreService 計算正式分數。Client 傳入的驗證數值不參與正式計分。

## 目前部署狀態

| 區域 | 狀態 | 內容 |
|---|---|---|
| Client App | 已實作 | React、Electron IPC、本機 GMAT 預驗證、HTTP Client |
| Central Server | 已實作於 Electron Server mode | FastAPI、Service、Repository、SQLite、Validation Worker、中央 GMAT、Leaderboard |
| FastAPI Cloud Relay | 已實作並部署 | FastAPI Cloud App `715e07b4-5ec3-4e69-b95d-b25587cc736c`；無狀態 health check 與公開 API forwarding；不暴露 internal worker API |

FastAPI Cloud 公開網址為 <https://missiondashboard.fastapicloud.dev>，平台已提供 HTTPS。目前 relay 已上線，但 `CENTRAL_SERVER_URL` 尚未設定，因此 `/health` 會回 `503`，Client、Cloud、中央 Server 的端到端連線尚未完成。正式上線仍需中央 Server 的安全公開入口、身分驗證與網路故障處理。

## 檔案結構

```text
frontend/  React、Vite、Electron、本機 GMAT 驗證
backend/   FastAPI、Service、Repository、SQLite、測試與情境文件
```

根目錄只負責說明與工作區層級設定。前端與後端各自擁有依賴、測試及建置產物，避免跨層混放。

## 開發

```bash
cd frontend
npm install
npm run electron:dev
```

`electron:dev` 每次啟動都會先詢問 Application Mode。執行期間不能切換角色；重新啟動後才能改選：

```bash
npm run electron:server
npm run electron:client
```

Server Mode 啟動中央 FastAPI、SQLite、Scenario Administration 與官方 GMAT Worker；Client Mode 只連線到指定 Server，不能修改 Scenario。

單獨執行後端只會啟動 API，不會啟動 Electron 中央 GMAT Worker：

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

本機啟動無狀態 Cloud relay（另一個終端）：

```bash
cd backend
CENTRAL_SERVER_URL=http://127.0.0.1:8000 \
  .venv/bin/python -m uvicorn cloud_relay.main:app --host 127.0.0.1 --port 8001
```

Client 的 Server address 設為 `http://127.0.0.1:8001`，所有公開 API 會由 Cloud relay 同步轉送。`/api/internal/*` 永遠不會由 Cloud 暴露。

### FastAPI Cloud

正式 relay 已部署至：

```text
https://missiondashboard.fastapicloud.dev
```

部署來源位於 `backend/cloud_relay/`。Cloud 不保存 Scenario、Solution、Submission 或 SQLite，只同步轉送公開 API。設定中央 Server 的安全公開網址後，使用以下指令更新 Cloud 環境變數並重新部署：

```bash
cd backend/cloud_relay
../.venv/bin/fastapi cloud env set CENTRAL_SERVER_URL "https://central-server.example.com"
../.venv/bin/fastapi deploy .
```

在 `CENTRAL_SERVER_URL` 完成前，不應把 Cloud URL 設為競賽 Client 的正式連線位址。

## 驗證

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../frontend && npm run lint && npm run build
```

詳細提交格式見 [backend/docs/gmat-validation-api-contract.md](backend/docs/gmat-validation-api-contract.md)。

## macOS 發布

安裝 build dependencies 後，可重跑 Apple Silicon 發布包：

```bash
cd backend && .venv/bin/pip install -r requirements-build.txt
cd ../frontend && npm install && npm run electron:build:mac
```

輸出檔為 `frontend/dist/Mission-Dashboard-<version>-arm64.dmg`。目前使用 ad-hoc code signing，尚未進行 Apple notarization；首次開啟可能需要在 Finder 右鍵選擇 Open。
