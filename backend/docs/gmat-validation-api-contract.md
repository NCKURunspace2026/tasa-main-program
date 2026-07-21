# GMAT 驗證與提交契約 v2

## 系統邊界

正式資料流固定為：

```text
React 輸入 Solution
→ Electron 本機 GMAT 預驗證
→ POST /api/submissions
→ SQLite 同一 transaction 保存 Solution + pending Submission
→ 中央 Validation Worker 執行 GMAT
→ passed / failed
→ Leaderboard 只查 passed Submission
```

Client 結果只是上傳門檻，不是正式分數。Electron Server mode 的 Worker 會 claim 最早的 `pending` Submission，以中央 GMAT 重新驗證。Worker 離線時 Submission 保持 `pending`，系統不得以 Client 或 Mock 結果加入排行榜。

## `POST /api/submissions`

```json
{
  "schemaVersion": 2,
  "scenarioId": "SC-001",
  "solution": {
    "name": "Team A run 01",
    "decisionVariables": {
      "tWait": 0,
      "burns": [
        { "deltaV": [0.1, 0.2, 0.3] }
      ],
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

成功回傳 HTTP `202 Accepted`：

```json
{
  "submissionId": "SUB-...",
  "solutionId": "SOL-...",
  "status": "accepted",
  "queueStatus": "pending",
  "message": "Saved by the central server and queued for official GMAT validation."
}
```

`accepted` 只表示中央 Server 已成功保存，不表示中央 GMAT 已通過。

## Scenario API

- `POST /api/scenarios/parse`：驗證及正規化 Scenario JSON，不寫入。
- `POST /api/scenarios`：僅 Server 裝置可建立正式 Scenario。
- `GET /api/scenarios`：取得 active Scenario 清單。
- `GET /api/scenarios/{id}`：取得完整 Scenario JSON。

Scenario 保存固定環境；Decision Variables 只能存在 Solution。

## Worker 與健康狀態

中央 Worker 使用啟動時產生的 `X-Worker-Token` 存取 internal API：

- `POST /api/internal/validation/heartbeat`
- `POST /api/internal/validation/next`
- `POST /api/internal/validation/{submissionId}/result`

這些端點不屬於 Client 公開契約。`GET /health` 的狀態為：

- `offline`：沒有近期 Worker heartbeat。
- `waiting-for-gmat`：Worker 已啟動，但 Server 尚未設定 GMAT。
- `ready`：Worker 與中央 GMAT 都可用，此時 `physicalValidation` 才是 `true`。

Result Parser 會讀取 GMAT 報告的全部有效 Cartesian state samples，計算整段傳播的 Minimum Distance；正式 ScoreService 僅使用中央結果與 Scenario `scoreConfig`。

## 尚未完成的部署邊界

FastAPI Cloud relay 已實作為無狀態同步轉送服務，包含中央 Server 健康檢查，並拒絕公開 `/api/internal/*`。本機可透過 `8001` 串接測試；正式環境仍需固定公開 URL、TLS、正式使用者驗證與跨網路 retry/idempotency 策略。
