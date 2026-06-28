# GMAT Python API — Lambert Rendezvous 使用指南

> 適用版本：GMAT R2026a
> 平台：Windows 10/11
> Python：3.9（官方測試版本）

---

## 目錄

1. [專案結構](#1-專案結構)
2. [環境準備](#2-環境準備)
3. [首次設定（必做）](#3-首次設定必做)
4. [Python 連結 GMAT API](#4-python-連結-gmat-api)
5. [執行 Lambert Rendezvous](#5-執行-lambert-rendezvous)
6. [程式架構說明](#6-程式架構說明)
7. [參數調整](#7-參數調整)
8. [常見錯誤排除](#8-常見錯誤排除)

---

## 1. 專案結構

```
gmat-win-R2026a/
├── bin/
│   ├── GMAT.exe
│   ├── gmat_py.pyd              ← C++ extension (GMAT 核心)
│   ├── api_startup_file.txt     ← 首次設定後產生
│   └── lambert_dc.script        ← 執行時自動產生
├── api/
│   ├── load_gmat.py             ← GMAT API 載入輔助檔 ⭐
│   ├── BuildApiStartupFile.py   ← 首次設定工具
│   ├── API_README.txt           ← 官方說明
│   └── gmat_lambert_optimization.py  ← 主程式 ⭐
└── data/
    └── gravity/
        └── earth/
            └── JGM3.cof         ← JGM-3 8x8 重力場模型
```

> **重要**：`load_gmat.py` 與 `gmat_lambert_optimization.py` 必須放在**同一個資料夾**下，或確保 Python 能找到 `load_gmat.py`。

---

## 2. 環境準備

### 2.1 安裝 Python 套件

```bash
pip install numpy scipy
```

### 2.2 確認 GMAT 安裝路徑

開啟 `load_gmat.py`，確認第 8 行的路徑與你的安裝位置一致：

```python
# load_gmat.py 第 8 行
GmatInstall = r"C:\Users\jaspe\Downloads\gmat-win-R2026a"
```

如果你的安裝路徑不同，**只需修改這一行**，其餘不需更動。

---

## 3. 首次設定（必做）

GMAT API 需要一個 `api_startup_file.txt`，這個檔案把 GMAT 的相對路徑轉換為絕對路徑，讓 Python 從任何位置都能正確載入資源。

### 步驟 1：開啟終端機，切換到 api 資料夾

```bash
cd C:\Users\jaspe\Downloads\gmat-win-R2026a\api
```

### 步驟 2：執行建立工具

```bash
python BuildApiStartupFile.py
```

執行成功後，`bin/` 資料夾下會出現 `api_startup_file.txt`。

```
成功標誌：
   bin/api_startup_file.txt  ← 這個檔案存在即代表設定完成
```

> 這個步驟**只需要做一次**。如果你移動了 GMAT 的安裝位置，需要重新執行。


## 4. 執行 Lambert Rendezvous

### 4.1 直接執行

執行gmat_lambert_optimization.py

```bash
cd C:\Users\jaspe\Downloads\gmat-win-R2026a\api
python gmat_lambert_optimization.py
```

### 4.2 預期輸出

```
=======================================================
  GMAT 3-Burn Lambert Rendezvous (Differential Corrector)
  Integrator: RungeKutta89 | Gravity: JGM-3 8x8
  Strategy: 2-Burn DC warm-start -> 3-Burn refinement
=======================================================

[Pass 1/2] 2-Burn Differential Corrector (JGM-3 8x8)...
  2-Burn initial guess:
    TOF       = 19440.00 s  (5.4000 h)
    DV1       = [ 2.4xxx  0.0xxx  0.0xxx]
    DV2       = [ 0.0xxx  1.5xxx  0.0xxx]
    Total DV  = 3.9xxx km/s

  2-Burn DC result:
    TOF       = 19xxx.xxxx s  (5.xxxx h)
    DV1       = [...] km/s
    DV2       = [...] km/s
    Miss dist = 0.000xxx km  (CONVERGED)

  Warm-start conversion -> 3-Burn initial guess:
    TOF1 = xxxxx.xx s  TOF2 = 60.00 s
    ...

[Pass 2/2] 3-Burn Differential Corrector (warm-started)...
  3-Burn DC result:
    TOF1      = xxxxx.xxxx s
    TOF2      = xxxxx.xxxx s
    DV1/2/3   = [...] km/s
    Total DV  = x.xxxxxx km/s
    Miss pos  = 0.000xxx km  (CONVERGED)
    Miss vel  = 0.000xxx km/s

=======================================================
  FINAL RESULT (3-Burn | RK89 | JGM-3 8x8)
=======================================================
  *** RENDEZVOUS ACHIEVED ***
```
### 4.3 GMAT 驗證

開啟gmat.exe，並開啟lambert_dc.script檔案，執行後即可看到結果.

---

## 5. 程式架構說明

### 5.1 整體流程

```
Python UV Solver (Lambert)
        │
        ▼
  initial_guess_2burn()
  快速計算 2-Burn 初始猜測（無重力攝動）
        │
        ▼
  run_2burn_dc()
  ├─ _write_script()  →  寫出 lambert_dc.script
  ├─ gmat.Clear()
  ├─ gmat.LoadScript()
  ├─ gmat.RunScript()  →  GMAT DC 在 JGM-3 8x8 下精算
  └─ 讀取 dv1, dv2, tof
        │
        ▼
  warm-start 轉換
  dv1=dv1_2b  dv2=0  dv3=dv2_2b  tof2=60s
        │
        ▼
  run_3burn_dc()
  ├─ _write_script()  →  寫出 lambert_dc.script
  ├─ gmat.Clear()
  ├─ gmat.LoadScript()
  ├─ gmat.RunScript()  →  GMAT DC 精算 3-Burn
  └─ 讀取 dv1, dv2, dv3, tof1, tof2
        │
        ▼
  輸出最終結果 + 收斂判斷
```

### 6.2 函式說明

| 函式 | 說明 |
|------|------|
| `stumpC(z)` / `stumpS(z)` | Stumpff 函數，通用變數軌道力學基礎 |
| `propagate_uv(r0, v0, dt, mu)` | 通用變數軌道傳播（Kepler 二體） |
| `solve_lambert(r1, r2, tof, mu)` | Lambert 問題求解器 |
| `initial_guess_2burn()` | 計算 2-Burn 初始猜測，回傳 `(dv1, dv2, tof_s)` |
| `initial_guess()` | 計算 3-Burn 初始猜測，回傳 `(dv1, dv2, dv3, tof1_s, tof2_s)` |
| `_write_script(template, path, **kwargs)` | 填入參數並寫出 GMAT 腳本（強制 ASCII） |
| `_run_gmat(filepath)` | 載入並執行腳本，回傳 `(ok, get_var_fn)` |
| `run_2burn_dc(script_path)` | 執行 2-Burn DC，回傳 `(dv1, dv2, tof)` |
| `run_3burn_dc(dv1, dv2, dv3, tof1, tof2, path)` | 執行 3-Burn DC，回傳完整結果 |

### 6.3 GMAT 腳本關鍵設定

| 設定項目 | 值 | 說明 |
|----------|----|------|
| `Integrator` | `RungeKutta89` | 高精度 8/9 階 RK 積分器 |
| `Gravity` | `JGM-3 8x8` | 8 階 8 次球諧重力場 |
| `Accuracy` | `1e-13` | 積分器容許誤差 |
| `DC MaxIterations` | 100 (2-Burn) / 300 (3-Burn) | DC 最大迭代次數 |
| `Achieve Tolerance` | `1e-3` km（位置）/ `1e-6` km/s（速度） | 收斂判斷標準 |

---

## 7. 參數調整

### 7.1 修改初始軌道條件

```python
# gmat_lambert_optimization.py 頂部
# EarthMJ2000Eq 座標系，單位：km 與 km/s

CHASER_R0 = np.array([6778.14, 0, 0.0])    # 追蹤者位置
CHASER_V0 = np.array([0, 7.6725, 0])       # 追蹤者速度
TARGET_R0 = np.array([26578.14, 0, 0.0])   # 目標位置
TARGET_V0 = np.array([0, 2.7388, 2.7388])  # 目標速度
```

### 7.2 修改 DC 求解器設定

在腳本模板字串中調整：

```
# 增加最大迭代次數
GMAT DC1.MaximumIterations = 500;

# 放寬收斂容許誤差（加速收斂）
Achieve DC1(dx = 0, {Tolerance = 0.1});     % 100 m

# 收緊收斂容許誤差（提高精度）
Achieve DC1(dx = 0, {Tolerance = 1e-4});    % 0.1 m
```

### 7.3 修改 Vary 搜尋範圍

```
# 擴大 DV 搜尋範圍
Vary DC1(dv1x = ..., {Perturbation = 0.01, Lower = -15, Upper = 15});

# 限制轉移時間範圍
Vary DC1(tof_sec = ..., {Perturbation = 10, Lower = 3600, Upper = 21600});
```

### 7.4 f-string 與 GMAT 大括號的衝突處理

GMAT 腳本中的 `{...}` 在 Python f-string 裡必須用 `{{...}}` 轉義：

```python
# 錯誤
f"Propagate Prop(SC) {SC.ElapsedSecs = tof};"

# 正確
f"Propagate Prop(SC) {{SC.ElapsedSecs = {tof:.2f}}};"
# 輸出 → Propagate Prop(SC) {SC.ElapsedSecs = 19440.00};

# Vary 語句
f"Vary DC1(dv1x = {val:.6f}, {{Perturbation = 0.01, Lower = -7, Upper = 7}});"

# Achieve 語句
f"Achieve DC1(dx = 0, {{Tolerance = 1e-3}});"
```
---

