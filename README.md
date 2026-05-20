# 🛰️ 軌道會合任務規劃系統 (Orbital Rendezvous Planning System)

這套系統提供了一個完整的航太工程工作流，專門用於解決**兩次推進 (Two-impulse) 軌道會合任務**。透過 Python 進行軌道力學計算與最佳化，並將結果無縫整合至 NASA GMAT 進行高保真度物理模擬。

---

## 📂 核心檔案總覽

本專案包含三個核心檔案，分別負責任務設計的不同階段：

| **檔案名稱** | **核心功能** | **角色定位** |
| :--- | :--- | :--- |
| `keplerian_to_eci.py` | 將直觀的克卜勒軌道要素轉換為 ECI 狀態向量。 | **任務設計起點** (翻譯機) |
| `lambert_problem_optimal.py` | 求解蘭伯特問題，尋找最佳飛行時間 (TOF)，並生成 3D 軌跡圖。 | **運算大腦** (最佳化與視覺化) |
| `lambert_optimal.script` | NASA GMAT 專用的任務腳本，用於模擬並驗證軌道交會。 | **物理驗證** (高保真度模擬) |

*透過這三個檔案的協作，您可以輕鬆完成從數學推導到工程驗證的完整閉環。*

---

## 🚀 標準工作流 (Workflow)

請依照以下三個步驟來規劃您的軌道會合任務：

### 步驟 1：定義初始軌道
如果您手邊只有軌道高度、傾角等克卜勒參數，請先執行 `keplerian_to_eci.py`。
- 在程式碼中修改 `INPUT_KEPLERIAN` 字典。
- 執行後，終端機會輸出格式化好的 `r` (位置) 與 `v` (速度) 向量。

### 步驟 2：計算最佳轉移軌道
將步驟 1 得到的向量貼入 `lambert_problem_optimal.py` 的 `CONFIG` 字典中。
- 調整 `"tof_bounds"` (允許的飛行時間範圍) 與 `"time_penalty"` (時間權重)。
- 執行程式。系統會自動尋找最省燃料的攔截時機，並彈出 Plotly 3D 互動視窗供您確認軌跡。
- 終端機會印出 GMAT 專用的 `ImpulsiveBurn` 與 `Propagate` 參數。
- 目前僅使用兩次推進，第一次為初始點與最後時可點火，未來這裡需改進。

### 步驟 3：GMAT 物理模擬驗證
開啟 NASA GMAT 軟體，載入 `lambert_optimal.script`。
- 根據步驟 2 終端機輸出的數據，修改腳本中的 `ImpulsiveBurn1` (第一次點火)、`ImpulsiveBurn2` (第二次點火) 的三軸 $$\Delta v$$ 數值。
- 修改 `Propagate` 的飛行時間 (`ElapsedSecs`)。
- 點擊 Run，在 3D 視圖中驗證兩顆衛星是否完美會合。

---

## ⚙️ 系統需求與相依套件

在執行 Python 腳本前，請確保您的環境已安裝以下套件：
- `numpy` (數值運算矩陣)
- `scipy` (數值最佳化演算法)
- `astropy` (天文單位與時間處理)
- `poliastro` (核心軌道力學引擎)
- `plotly` (3D 互動視覺化)

您可以透過以下指令一次安裝完畢：
```bash
pip install numpy scipy astropy poliastro plotly
