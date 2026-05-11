# TASA 軌道設計練習：2D 基準解流程

## 目標

外星飛船 A 為圓形軌道，我方 Spacecraft B 從初始狀態出發，設計 maneuver 讓 B 盡可能接近 A。

這一份先假設所有運動都在同一平面：

```text
z = 0
Vz = 0
ΔVz = 0
```

也就是先把問題簡化成 2D 軌道追逐問題。

---

## 為什麼先做 2D

2D 是 3D 的特例。

如果 2D 都找不到好解，直接做 3D 最佳化會很容易亂掉。

所以第一步應該先建立一組穩定的 baseline solution。

```text
2D baseline = 可解、可檢查、可拿來當 3D initial guess 的基準解
```

---

## 問題設定

### 外星飛船 A

A 是圓形軌道。

```text
rA(0) = [7000, 0, 0] km
vA(0) = [0, 7.546, 0] km/s
```

### 我方 Spacecraft B

B 從給定初始狀態出發。

```text
rB(0) = [6800, -1200, 0] km
vB(0) = [1.20, 7.35, 0] km/s
```

---

## 設計變數

2D 版本先只開放平面內 maneuver：

```text
t1
ΔV1x
ΔV1y
t2
ΔV2x
ΔV2y
```

固定：

```text
ΔV1z = 0
ΔV2z = 0
```

---

## 評分目標

真正要最佳化的不是軌道本身，而是 Score。

```text
maximize Score = f(Δr_min, ΔV_team, t_team) - penalties
```

主要指標：

```text
Δr_min     = 任務期間 B 與 A 的最近距離
ΔV_team    = 所有 maneuver 的 ΔV 總和
t_team     = 任務完成時間
penalties  = 違規懲罰
```

---

## 解題流程

```text
1. Propagate A 的圓形軌道
2. Propagate B 的初始軌道
3. 選定第一次 maneuver 時間 t1
4. 對 B 加上 ΔV1
5. Propagate 到 t2
6. 對 B 加上 ΔV2
7. 繼續 propagate 到 t_team
8. 計算整段時間內的 Δr_min
9. 計算 ΔV_team
10. 代入 Score
11. 搜尋 Score 最大的組合
```

---

## 最基本的搜尋方法

### 方法 1：Grid Search

先粗略掃描：

```text
t1 range
ΔV1x range
ΔV1y range
t2 range
ΔV2x range
ΔV2y range
```

優點：

```text
直覺
不容易錯
可以看到 Score landscape
```

缺點：

```text
慢
維度高時成本爆炸
```

---

### 方法 2：Lambert Transfer

掃描不同 arrival time：

```text
for tf in candidate arrival times:
    rA(tf) = target position
    solve Lambert from rB(t0) to rA(tf)
    compute ΔV1
    compute arrival velocity mismatch ΔV2
    compute Score
```

這通常比盲目掃描更有效。

---

## 2D 策略直覺

如果 B 落後 A：

```text
降低軌道高度
週期變短
B 追上 A
接近後再修正速度
```

如果 B 超前 A：

```text
提高軌道高度
週期變長
讓 A 追上 B
接近後再修正速度
```

這就是 phasing orbit 的基本概念。

---

## 要觀察的結果

每組解都要記錄：

```text
1. t1
2. ΔV1 = [ΔV1x, ΔV1y, 0]
3. t2
4. ΔV2 = [ΔV2x, ΔV2y, 0]
5. Δr_min
6. ΔV_team
7. t_team
8. Score
```

---

## 判斷好壞

不要只看最近距離。

高分解通常是：

```text
距離夠近
ΔV 不太大
時間不要太久
沒有 penalty
```

也就是：

```text
最佳軌道 ≠ 最近軌道
最佳軌道 = Score 最高的軌道
```

---

## 這份 2D 解的用途

2D baseline 解不是最終答案，而是下一階段 3D 最佳化的起點。

```text
2D best solution
        ↓
3D optimizer initial guess
        ↓
開放 ΔVz 微調
        ↓
比較 Score 是否提升
```

