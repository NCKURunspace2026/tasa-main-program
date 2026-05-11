# TASA 軌道設計練習題庫 Part B
# 外星飛船是雙曲線軌道

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

# 題目 B1：雙曲線 Flyby 接近任務

## 題目敘述

外星飛船 A 不是繞地球的封閉軌道，而是以雙曲線軌道飛掠地球。我方 B 從低地球軌道出發，必須在 A 飛離前盡量接近它。

## 已知條件

外星飛船 A：

```text
rA(0) = [-30000, -20000, 0] km
vA(0) = [4.5, 6.5, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [7000, 0, 0] km
vB(0) = [0, 7.546, 0] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 1.5 km/s
任務時間 ≤ 12000 s
ΔVz = 0
```

## 練習重點

```text
hyperbolic target
high-speed flyby
Lambert transfer
```

---

# 題目 B2：雙曲線目標 + 時間窗口

## 題目敘述

外星飛船 A 是雙曲線軌道，但任務規定只有在指定時間窗口內的接近才算有效。

## 已知條件

外星飛船 A：

```text
rA(0) = [-50000, 10000, 0] km
vA(0) = [7.0, -1.5, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [6800, 0, 0] km
vB(0) = [0, 7.656, 0] km/s
```

## 限制

```text
最多 2 次 impulsive maneuver
總 ΔV ≤ 2.0 km/s
有效接近時間：3000 s ≤ t_team ≤ 10000 s
ΔVz = 0
```

## 練習重點

```text
time window
Score-based timing
不是越近越好
```

---

# 題目 B3：雙曲線目標，小燃料限制

## 題目敘述

外星飛船 A 以雙曲線軌道快速飛掠。我方 B 的燃料非常有限，不一定能真正攔截。請找出最高分 compromise solution。

## 已知條件

外星飛船 A：

```text
rA(0) = [-25000, -30000, 0] km
vA(0) = [5.5, 5.0, 0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [7200, 0, 0] km
vB(0) = [0, 7.44, 0] km/s
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
有限燃料最佳接近
Score compromise
不要只追最近距離
```

---

# 題目 B4：雙曲線目標，3D 接近任務

## 題目敘述

外星飛船 A 是三維雙曲線軌道。我方 B 從赤道附近低軌道出發，必須設計三維 maneuver 接近 A。

## 已知條件

外星飛船 A：

```text
rA(0) = [-40000, -10000, 8000] km
vA(0) = [5.8, 4.2, -1.0] km/s
```

我方 Spacecraft B：

```text
rB(0) = [7000, 0, 0] km
vB(0) = [0, 7.546, 0] km/s
```

## 限制

```text
最多 3 次 impulsive maneuver
總 ΔV ≤ 2.5 km/s
任務時間 ≤ 18000 s
允許三維 maneuver
```

## 練習重點

```text
3D Lambert transfer
inclination correction
out-of-plane maneuver
```

---

# 題目 B5：雙曲線目標，逃逸者故意遠離

## 題目敘述

外星飛船 A 在雙曲線軌道上，並且它的初始速度方向讓它快速遠離 B。B 必須判斷是否要積極追擊，或選擇較省燃料的接近策略。

## 已知條件

外星飛船 A：

```text
rA(0) = [-35000, 25000, 5000] km
vA(0) = [6.2, 3.8, 0.8] km/s
```

我方 Spacecraft B：

```text
rB(0) = [6800, 0, 0] km
vB(0) = [0, 7.656, 0] km/s
```

## 限制

```text
最多 3 次 impulsive maneuver
總 ΔV ≤ 1.8 km/s
任務時間 ≤ 20000 s
允許三維 maneuver
```

## 任務

比較：

```text
策略 1：積極追擊
策略 2：省燃料接近
```

## 練習重點

```text
pursuit strategy
fuel-distance trade-off
不要只追最小 Δr_min
```

