# TASA 軌道設計練習題庫 Part A
# 外星飛船是圓形軌道

---

# 共用評分公式

```text
Score = Distance Score + Time Score + Fuel Score - Penalty
```

其中：

```text
Distance Score = 50 exp(-(Δr_min - 5)/100)
Time Score     = 25 / (1 + exp(0.003(t_team - 3600)))
Fuel Score     = 25 / (1 + exp(8(ΔV_team - 0.35)))
```

---

# 題目 A1：同高度圓軌道，相位追趕

## 題目敘述

外星飛船 A 與我方 Spacecraft B 都在同一個圓形軌道上，但 B 落後 A 一段相位角。請設計 maneuver，讓 B 在有限時間內盡量接近 A。

## 已知條件

```text
μ = 398600 km^3/s^2
```

外星飛船 A：

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [6062.18, -3500.00, 0] km
vB(0) = [3.773, 6.535, 0] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 0.5 km/s
任務時間 ≤ 12000 s
ΔVz = 0
```

## 練習重點

```text
phasing orbit
相位追趕
週期差
```

---

# 題目 A2：不同高度圓軌道轉移

## 題目敘述

外星飛船 A 在較高的圓軌道。我方 B 在較低的圓軌道，且初始相位不同。請設計 maneuver，使 B 接近 A。

## 已知條件

外星飛船 A：

```text
rA(0) = [7200, 0, 0] km
vA(0) = [0, 7.440, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [3400, -5888.97, 0] km
vB(0) = [6.638, 3.832, 0] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 0.8 km/s
任務時間 ≤ 15000 s
ΔVz = 0
```

## 練習重點

```text
Hohmann transfer
phasing + transfer
arrival timing
```

---

# 題目 A3：B 是橢圓軌道，A 是圓軌道

## 題目敘述

外星飛船 A 是圓形軌道。我方 B 從一個非圓形初始軌道出發。請設計兩次 maneuver，使 B 盡可能高分接近 A。

## 已知條件

外星飛船 A：

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [6800, -1200, 0] km
vB(0) = [1.20, 7.35, 0] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 0.8 km/s
任務時間 ≤ 7200 s
ΔVz = 0
```

## 練習重點

```text
Lambert transfer
數值最佳化
最近距離計算
```

---

# 題目 A4：只允許一次 maneuver

## 題目敘述

外星飛船 A 是圓形軌道。我方 B 只能做一次 maneuver。請找出最高分的單次軌道機動。

## 已知條件

外星飛船 A：

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [7100, -900, 0] km
vB(0) = [0.8, 7.2, 0] km/s
```

## 限制

```text
只能 1 次 impulsive maneuver
總 ΔV ≤ 0.6 km/s
任務時間 ≤ 5400 s
ΔVz = 0
```

## 練習重點

```text
single-burn interception
maneuver timing
```

---

# 題目 A5：圓軌道目標，3D 初始偏差

## 題目敘述

外星飛船 A 仍然是圓形軌道，但我方 B 的初始位置與速度有 z 方向偏差。請比較 2D 解與 3D 解的 Score。

## 已知條件

外星飛船 A：

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [6800, -1200, 120] km
vB(0) = [1.20, 7.35, 0.03] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 0.9 km/s
任務時間 ≤ 7200 s
```

## 任務

```text
先做 2D baseline
再做 3D refinement
比較 Score_2D 與 Score_3D
```

## 練習重點

```text
3D correction
z error
out-of-plane maneuver
```

