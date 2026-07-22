# GMAT 驗證與提交契約 v2

## 系統邊界

```text
React 輸入 Solution
→ Electron 本機 GMAT 預驗證
→ 本機 FastAPI POST /api/submissions
→ 本機 SQLite transaction 保存 Solution + pending Submission
→ 本機 GMAT Worker 主動 claim
→ GMAT propagation
→ Worker POST passed / failed
→ Leaderboard 只查 passed Submission
```

Client 結果只是上傳門檻，不參與正式計分。Worker 離線時 Submission 保持 `pending`；系統不得以 Client 或 Mock 數值加入排行榜。

## `POST /api/submissions`

Request：

```json
{
  "schemaVersion": 2,
  "scenarioId": "SC-001",
  "solution": {
    "name": "Team A run 01",
    "decisionVariables": {
      "tWait": 0,
      "burns": [{ "deltaV": [0.1, 0.2, 0.3] }],
      "finalCoastTime": 5000
    }
  },
  "clientValidation": {
    "passed": true,
    "provider": "local-gmat-console",
    "minimumDistanceKm": 4.8,
    "missionTimeSec": 5000,
    "totalDeltaVKmPerSec": 0.374
  }
}
```

成功回傳 HTTP `202 Accepted`；`accepted` 只表示目前裝置已持久化與排入 Queue，不代表官方 GMAT 已通過。

## Worker 契約

組內 Electron 裝置可在 Settings 勾選 Worker；目前 Internal API 不使用共享 token：

- `POST /api/internal/validation/heartbeat`：包含穩定 `workerId`、provider 與 `gmatConfigured`。
- `POST /api/internal/validation/next`：包含 `workerId`，回傳任務、`claimToken` 與 `leaseExpiresAt`。
- `POST /api/internal/validation/{submissionId}/result`：必須回傳相同 `workerId` 與 `claimToken`。

SQLite 使用條件式 update 避免同一裝置的多 Worker 同時領取同一任務。Claim lease 預設 180 秒；Worker 崩潰後任務可重新排入，而舊 claim token 會失效。

## Scenario 管理

- `GET /api/scenarios` 與 `GET /api/scenarios/{id}`：公開讀取。
- `POST /api/scenarios/parse`：只驗證，不寫入。
- `POST /api/scenarios` 與 `PUT /api/scenarios/{id}`：由 Electron main process 代理管理請求。
- `DELETE /api/scenarios/{id}`：將 status 改為 `inactive`；`POST /restore` 可恢復。
- Solution 刪除寫入 `deleted_at`，排行榜與一般 detail 預設排除；資料匯出仍包含 archived 紀錄。

這是組內 pre-auth 信任模型；對外開放前必須加上身分驗證、角色授權與稽核紀錄。

Scenario 保存固定物理環境；Decision Variables 只能存在 Solution。

## 健康狀態

`GET /health`：

- `database: "sqlite"`：本機 SQLite 可用。
- `nodeRole: "local"`：正式本地資料節點；`relay` 表示可重建中繼快取。
- `validationWorker: "offline"`：沒有 30 秒內 heartbeat。
- `waiting-for-gmat`：Worker 在線但尚未設定 GMAT。
- `ready`：Worker 與 GMAT 都可用；此時 `physicalValidation` 才是 `true`。

Result Parser 讀取 GMAT 報告的全部有效 Cartesian samples，計算整段 propagation 的 minimum distance；ScoreService 只使用官方 Worker 結果與 Scenario `scoreConfig`。
