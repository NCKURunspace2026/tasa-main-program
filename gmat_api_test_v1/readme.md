# GMAT N-Burn Multi-Impulse Rendezvous

透過**差分修正器（Differential Corrector）**求解 N 次脈衝的軌道交會問題，結合解析 Lambert 解與 GMAT 高保真軌道傳播（RK89 積分器 + JGM-3 8×8 重力場）。

---

## 📌 概述

本工具讓「追逐者（Chaser）」太空船透過 N 次脈衝機動，與「目標（Tgt）」太空船完成位置與速度的完全交會。

採用**兩階段策略**：

1. **Pass 1 — 2-Burn 暖啟動**：以 Lambert 解掃描最佳飛行時間，交由 GMAT DC 收斂出可靠的 2 脈衝基礎解。
2. **Pass 2 — N-Burn 精修**：用多重 Lambert 前向射擊優化時間分配，再由 GMAT DC 對所有脈衝與時間做全自由變數收斂。

---

## ⚙️ 環境需求

| 項目 | 版本 / 說明 |
|------|-------------|
| Python | 3.8+ |
| GMAT | R2026a（含 Python API） |
| NumPy | 任意近期版本 |
| SciPy | 任意近期版本（`optimize` 模組） |

> **注意**：需正確設定 GMAT 安裝路徑與重力場檔案 `JGM3.cof`。

---

## 🚀 安裝與設定

1. 安裝 GMAT R2026a，確認 `bin/` 目錄含 `load_gmat.py`。
2. 修改程式碼頂部的路徑常數：

```python
GMAT_BIN = r"C:\path\to\gmat\bin"
```

3. 確認重力場檔案存在於 `../data/gravity/earth/JGM3.cof`。
4. 安裝 Python 依賴：

```bash
pip install numpy scipy
```

---

## 🔧 參數配置

於程式碼頂部的 **USER-CONFIGURABLE** 區塊調整：

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `N_BURNS` | `10` | 脈衝數量（須 ≥ 2） |
| `MAX_SINGLE_DV_KMS` | `1.5` | 單次脈衝 ΔV 上限（km/s） |
| `MAX_TOF_SEC` | `36000.0` | 總飛行時間上限（s） |
| `MIN_TOF_SEC` | `1800.0` | 總飛行時間下限（s） |
| `MIN_COAST_SEC` | `60.0` | 每段最短滑行時間（s） |

初始軌道狀態（`CHASER_R0/V0`、`TARGET_R0/V0`）亦可於同區塊修改。

---

## ▶️ 執行

```bash
python rendezvous_nburn.py
```

程式會自動：
1. 計算 2-burn Lambert 初始猜測
2. 執行 2-burn GMAT DC
3. 優化 N-burn 時間分配
4. 執行 N-burn GMAT DC 精修
5. 輸出最終解與約束檢查報告

---

## 📊 輸出說明

最終報告包含：

- **每次脈衝**的 ΔV 向量與大小
- **每段**的飛行時間
- **總 ΔV** 與 **總 TOF**
- **位置/速度殘差**（miss distance）
- **約束檢查**（單脈衝上限、總時間上限）

收斂判定：位置殘差 < 0.01 km 視為 `CONVERGED`。

---

## 🏗️ 程式架構

```
main()
├── run_2burn_dc()           # Pass 1：2-burn 暖啟動
│   ├── initial_guess_2burn()    # Lambert TOF 掃描
│   └── run_gmat()               # 載入並執行 GMAT 腳本
│
├── convert_2burn_to_nburn() # Pass 2a：轉換為 N-burn
│   └── optimize_nburn_tof_split()  # L-BFGS-B 時間優化
│       └── generate_multi_lambert_guess()  # 多重 Lambert 射擊
│
└── run_nburn_dc()           # Pass 2b：N-burn 精修
    └── build_gmat_script()      # 動態生成 GMAT 腳本

核心數值模組：
├── propagate_uv()    # 通用變數 Keplerian 傳播
├── solve_lambert()   # Lambert 求解器（二分法）
├── stumpC/stumpS()   # Stumpff 函數
```

---

## 🐛 已知修正（v1 → v2）

| 編號 | 修正內容 |
|------|----------|
| F1 | `propagate_uv` 速度回傳遺漏 `gdot` 項 |
| F2 | Lambert 共線（A≈0）與 y<0 發散防護 |
| F3 | `Propagate` 雙大括號改單大括號 |
| F4 | `Vary` 選項改用小括號 |
| F5 | `Achieve` 容差改用小括號 |
| F6 | `Burn.Element` 賦值移至 `Target` 區塊外 |
| F7 | 雙太空船同步傳播語法修正 |
| F8 | `tof_leg_upper` 加上最小值地板防止負界 |
| F9 | `get_var` 加入 `GetField` 後備讀取 |
| F10 | `initial_guess_2burn` 加入幾何例外處理 |
| F11 | 補上 `EndMissionSequence` |
| F12 | 變數宣告移至 `BeginMissionSequence` 前 |

---

## ⚠️ 注意事項

- **高 N 收斂風險**：N 越大自由變數越多（每脈衝 3 + 每段 1），DC 可能不收斂。建議從小 N 測試起。
- **路徑依賴**：JGM-3 重力場檔案路徑為相對路徑，請確認工作目錄正確。
- **若不收斂**：嘗試降低 `N_BURNS`、放寬 TOF 限制，或調整初始軌道幾何。

---

## 📖 理論背景

- **通用變數法（Universal Variable）**：統一處理橢圓、拋物、雙曲軌道的 Kepler 傳播。
- **Lambert 問題**：已知兩點位置與飛行時間，求轉移軌道速度。
- **差分修正器（DC）**：透過數值雅可比矩陣迭代，調整自由變數使約束殘差歸零。

---

## 📜 授權

請依實際專案需求補充授權條款。
