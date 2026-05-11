# TASA 軌道設計練習：3D 最佳化流程

## 目標

在外星飛船 A 為圓形軌道的情況下，我方 Spacecraft B 不只使用平面內 maneuver，也允許使用 out-of-plane maneuver，尋找更高 Score 的軌跡。

3D 版本允許：

```text
ΔVz ≠ 0
z ≠ 0
```

---

## 核心觀念

3D 最佳化的搜尋空間比 2D 大。

因為 2D 是 3D 的特例：

```text
2D case: ΔVz = 0
3D case: ΔVz can be nonzero
```

所以理論上：

```text
Best Score in 3D ≥ Best Score in 2D
```

但不代表 3D 一定值得。

因為 out-of-plane maneuver 會增加 ΔV，而 Score 也會懲罰 ΔV。

---

## 什麼時候 3D 有用

3D 最佳化比較有價值的情況：

```text
1. A 與 B 的軌道平面不同
2. 最近距離主要來自 z direction error
3. 不需要完整 plane change，只需要接近時修正 z offset
4. 距離分數提升大於 ΔV 分數損失
```

如果 A、B 幾乎同平面，3D 不一定會提升很多。

---

## 問題設定

### 外星飛船 A

A 是圓形軌道。

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

### 我方 Spacecraft B

可以從 2D 題目的初始條件開始，也可以加入小的 z 偏差：

```text
rB(0) = [6800, -1200, 100] km
vB(0) = [1.20, 7.35, 0.02] km/s
```

這樣可以測試 3D 修正是否有價值。

---

## 設計變數

3D 版本開放完整三軸 maneuver：

```text
t1
ΔV1x
ΔV1y
ΔV1z
t2
ΔV2x
ΔV2y
ΔV2z
```

如果允許三次 maneuver：

```text
t3
ΔV3x
ΔV3y
ΔV3z
```

但初期建議先用 2 次 maneuver。

---

## 最佳化目標

目標仍然是最大化 Score。

```text
maximize Score = f(Δr_min, ΔV_team, t_team) - penalties
```

不要把目標設成單純最小化距離。

因為太大的 plane change 可能讓距離變近，但總分下降。

---

## 推薦流程

不要一開始就直接全 3D 搜尋。

推薦流程：

```text
Stage 1：2D Baseline
    固定 ΔVz = 0
    找到一組高分解

Stage 2：3D Refinement
    用 2D 解當 initial guess
    開放 ΔV1z, ΔV2z
    讓 optimizer 微調

Stage 3：Score Comparison
    比較 2D Score 與 3D Score
    如果提升不明顯，保留 2D 解
```

---

## 為什麼不要一開始就全開 3D

因為 3D 搜尋維度更高：

```text
2D: t1, ΔV1x, ΔV1y, t2, ΔV2x, ΔV2y
3D: t1, ΔV1x, ΔV1y, ΔV1z, t2, ΔV2x, ΔV2y, ΔV2z
```

維度增加會造成：

```text
1. 搜尋時間變長
2. 容易卡在 local optimum
3. 產生物理上不合理的 maneuver
4. ΔV 被 out-of-plane correction 吃掉
```

所以 3D 最好拿來精修，不要拿來盲搜。

---

## 3D 最佳化檢查項目

每一組 3D 解都要檢查：

```text
1. ΔV_team 是否超過限制
2. t_team 是否超過限制
3. 最近點是否真的接近 A
4. 最近點發生時的 z error 是否變小
5. ΔVz 是否太大
6. Score 是否真的比 2D 高
```

特別要分開看：

```text
x-y plane distance
z direction distance
total distance
```

因為總距離：

```text
Δr = sqrt(Δx^2 + Δy^2 + Δz^2)
```

如果 2D 已經讓 Δx, Δy 很小，但 Δz 還很大，3D 修正就可能有效。

---

## 3D 的策略直覺

### 錯誤做法

```text
一開始就大幅改 inclination
```

這通常很耗 ΔV。

---

### 較好的做法

```text
先用 2D phasing / transfer 接近目標
接近前或接近時做小的 out-of-plane correction
只修正必要的 z error
```

也就是：

```text
先解 x-y 問題
再修 z 問題
```

---

## 什麼時候保留 2D 解

如果結果是：

```text
3D Score - 2D Score < 很小的 threshold
```

例如只提升 0.1 分或 0.5 分，但 maneuver 複雜很多，那就保留 2D。

比賽不是要展示最複雜的軌道，而是要拿最高分。

---

## 最終輸出格式

```text
2D Baseline Result:
    t1
    ΔV1 = [ΔV1x, ΔV1y, 0]
    t2
    ΔV2 = [ΔV2x, ΔV2y, 0]
    Δr_min
    ΔV_team
    t_team
    Score_2D

3D Refined Result:
    t1
    ΔV1 = [ΔV1x, ΔV1y, ΔV1z]
    t2
    ΔV2 = [ΔV2x, ΔV2y, ΔV2z]
    Δr_min
    ΔV_team
    t_team
    Score_3D

Comparison:
    Score improvement = Score_3D - Score_2D
    Decision = use 2D or 3D
```

---

## 一句話總結

3D 最佳化比較強，但不要一開始就全開。

最穩的策略是：

```text
2D 找方向，3D 做精修，最後只看 Score 決定要不要採用。
```

