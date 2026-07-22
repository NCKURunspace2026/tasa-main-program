# GMAT 驗證與提交契約 v2

## 系統邊界

```text
React 輸入 Solution
→ Electron 本機 GMAT 預驗證
→ 本機 FastAPI POST /api/submissions
→ FastAPI 檢查 Decision Variables 與 GMAT metrics 一致
→ ScoreService 計算本機分數
→ 本機 SQLite transaction 保存 passed Solution + Submission
→ Leaderboard 只查 passed Submission
```

每筆答案只執行一次本機 GMAT。主辦方收到正式答案後會用自己的工具再次驗證；Mission Dashboard 不再維護第二層 official worker queue。

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

成功回傳 HTTP `201 Created` 與 `status: "passed"`；代表本機 GMAT 已通過、分數已產生並寫入本機資料庫。

## Scenario 管理

- `GET /api/scenarios` 與 `GET /api/scenarios/{id}`：公開讀取。
- `POST /api/scenarios` 與 `PUT /api/scenarios/{id}`：由 Electron main process 代理管理請求。
- Scenario 永遠有效，不提供 inactive、DELETE 或 restore API。
- Solution Remove 必須輸入裝置管理密碼；刪除寫入 `deleted_at`，排行榜、一般 detail 與預設 ML 匯出都會排除。只有明確使用 `includeArchived=true` 的稽核／復原匯出才包含 archived 紀錄。

這是組內 pre-auth 信任模型；對外開放前必須加上身分驗證、角色授權與稽核紀錄。

Scenario 保存固定物理環境；Decision Variables 只能存在 Solution。

### Force Model

`scenarioJson.forceModel` 是 GMAT ForceModel 的唯一設定來源：

- `centralBody`：目前管理介面限定 `Earth`。
- `gravity.enabled`：是否使用球諧重力；關閉時仍保留中心天體點質量重力（degree/order 皆為 0）。
- `gravity.degree` / `gravity.order`：非負整數，且 order 不得大於 degree。
- `pointMasses`：可加入 `Sun`、`Luna` 等第三體，不能重複加入 central body。
- `drag`：Earth 可選 `JacchiaRoberts` 或 `MSISE90`。
- `solarRadiationPressure.enabled`：對應 GMAT R2026a 的 `FM.SRP = On/Off`。
- `relativisticCorrection`：布林開關。

Electron 產生 GMAT script 時必須逐項寫入上述設定，不得再硬編碼成固定 Earth-only model。Scenario epoch 可使用 ISO 8601 UTC 或 GMAT UTCGregorian；產生器會轉成 GMAT 接受的 UTCGregorian 字串。

## 健康狀態

`GET /health`：

- `database: "sqlite"`：本機 SQLite 可用。
- `nodeRole: "local"`：正式本地資料節點；`relay` 表示可重建中繼快取。
- `validationMode: "single-local-gmat"`：本機裝置只執行一次 GMAT。
- `validationMode: "none"`：Relay 不執行 GMAT。

Result Parser 讀取 GMAT 報告的全部有效 Cartesian samples，計算整段 propagation 的 minimum distance；ScoreService 使用這次本機 GMAT 結果與 Scenario `scoreConfig`。
