import numpy as np
import plotly.graph_objects as go
from astropy import units as u
from astropy.time import Time
from poliastro.bodies import Earth
from poliastro.twobody import Orbit
from poliastro.iod import izzo
from scipy.optimize import minimize_scalar

# 可配置的初始條件與最佳化參數
CONFIG = {
    "chaser": {
        "r": [-6885.175422, -1090.504656, 0.0],
        "v": [0.499922, -3.156382, -6.853258],
    },
    "target": {
        "r": [0.0, 6971.0, 0.0],
        "v": [-5.34, 0.0, 5.34],
    },
    "tof_bounds": (0.5, 12.0),
    "time_penalty": 0.2, 
}

def lambert_problem_optimal():
    cfg = CONFIG
    # GMAT 預設常用的 Epoch 格式
    epoch_str = "2026-05-20 12:00:00.000"
    epoch = Time(epoch_str, scale="utc")
    mu = Earth.k
    
    # 建立初始軌道
    chaser = Orbit.from_vectors(Earth, cfg["chaser"]["r"] * u.km, cfg["chaser"]["v"] * u.km / u.s, epoch)
    target = Orbit.from_vectors(Earth, cfg["target"]["r"] * u.km, cfg["target"]["v"] * u.km / u.s, epoch)
    r_chaser_now, v_chaser_now = chaser.rv()

    # 1. 執行最佳化
    def cost_function(tof_hours):
        try:
            tof = tof_hours * u.h
            target_future = target.propagate(tof)
            r_target_future, _ = target_future.rv()
            v1_transfer, v2_transfer = list(izzo.lambert(mu, r_chaser_now, r_target_future, tof))[0]
            
            dv1 = np.linalg.norm((v1_transfer - v_chaser_now).value)
            dv2 = np.linalg.norm((target_future.v - v2_transfer).value)
            return dv1 + dv2 + (cfg["time_penalty"] * tof_hours)
        except Exception:
            return 1e6

    print("正在搜尋最佳飛行時間 (TOF)...")
    res = minimize_scalar(cost_function, bounds=cfg["tof_bounds"], method='bounded')
    best_tof_hours = res.x
    best_tof = best_tof_hours * u.h
    
    # ==========================================
    # 2. 計算最佳解的精確向量與軌道物件
    # ==========================================
    target_future = target.propagate(best_tof)
    r_target_future, v_target_future = target_future.rv()
    v1_transfer, v2_transfer = list(izzo.lambert(mu, r_chaser_now, r_target_future, best_tof))[0]
    
    # 計算 Delta-v 向量 (ECI 坐標系) 與總消耗
    dv1_vec = (v1_transfer - v_chaser_now).to(u.km / u.s).value
    dv2_vec = (v_target_future - v2_transfer).to(u.km / u.s).value
    best_total_dv = np.linalg.norm(dv1_vec) + np.linalg.norm(dv2_vec)
    tof_secs = best_tof.to(u.s).value

    # 建立轉移軌道物件 (供繪圖使用)
    transfer_orbit = Orbit.from_vectors(Earth, r_chaser_now, v1_transfer, epoch)

    # 3. 輸出 GMAT 專用驗證參數
    print("\n" + "="*55)
    print("GMAT 驗證專用參數 (Coordinate System: EarthMJ2000Eq) 🚀")
    print("="*55)
    
    print(f"\n[Epoch (UTC)]")
    print(f"DateFormat = UTCGregorian")
    print(f"Epoch      = {epoch.strftime('%d %b %Y %H:%M:%S.%f')[:-3]}")

    print(f"\n[Spacecraft: Chaser 初始狀態]")
    print(f"X  = {cfg['chaser']['r'][0]:.6f} km")
    print(f"Y  = {cfg['chaser']['r'][1]:.6f} km")
    print(f"Z  = {cfg['chaser']['r'][2]:.6f} km")
    print(f"VX = {cfg['chaser']['v'][0]:.6f} km/s")
    print(f"VY = {cfg['chaser']['v'][1]:.6f} km/s")
    print(f"VZ = {cfg['chaser']['v'][2]:.6f} km/s")

    print(f"\n[Spacecraft: Target 初始狀態]")
    print(f"X  = {cfg['target']['r'][0]:.6f} km")
    print(f"Y  = {cfg['target']['r'][1]:.6f} km")
    print(f"Z  = {cfg['target']['r'][2]:.6f} km")
    print(f"VX = {cfg['target']['v'][0]:.6f} km/s")
    print(f"VY = {cfg['target']['v'][1]:.6f} km/s")
    print(f"VZ = {cfg['target']['v'][2]:.6f} km/s")

    print(f"\n[ImpulsiveBurn 1: 離開原軌道 (dv1)]")
    print(f"Element1 (dX) = {dv1_vec[0]:.6f} km/s")
    print(f"Element2 (dY) = {dv1_vec[1]:.6f} km/s")
    print(f"Element3 (dZ) = {dv1_vec[2]:.6f} km/s")

    print(f"\n[Propagate: 轉移時間]")
    print(f"Parameter = Chaser.ElapsedSecs")
    print(f"Condition = {tof_secs:.6f}")

    print(f"\n[ImpulsiveBurn 2: 匹配目標軌道 (dv2)]")
    print(f"Element1 (dX) = {dv2_vec[0]:.6f} km/s")
    print(f"Element2 (dY) = {dv2_vec[1]:.6f} km/s")
    print(f"Element3 (dZ) = {dv2_vec[2]:.6f} km/s")
    print("="*55 + "\n")

    # 4. Plotly 3D 視覺化
   
    def get_orbit_points(orbit, num_points=150):
        period = orbit.period.to(u.s).value
        times = np.linspace(0, period, num_points) * u.s
        x, y, z = [], [], []
        for t in times:
            pos = orbit.propagate(t).r.to(u.km).value
            x.append(pos[0])
            y.append(pos[1])
            z.append(pos[2])
        return x, y, z

    cx, cy, cz = get_orbit_points(chaser)
    tx, ty, tz = get_orbit_points(target)
    
    times_trans = np.linspace(0, best_tof.to(u.s).value, 100) * u.s
    trx, try_, trz = [], [], []
    for t in times_trans:
        pos = transfer_orbit.propagate(t).r.to(u.km).value
        trx.append(pos[0])
        try_.append(pos[1])
        trz.append(pos[2])

    fig = go.Figure()

    # 地球
    R_earth = Earth.R.to(u.km).value
    u_angle = np.linspace(0, 2 * np.pi, 100)
    v_angle = np.linspace(0, np.pi, 100)
    x_earth = R_earth * np.outer(np.cos(u_angle), np.sin(v_angle))
    y_earth = R_earth * np.outer(np.sin(u_angle), np.sin(v_angle))
    z_earth = R_earth * np.outer(np.ones(np.size(u_angle)), np.cos(v_angle))
    fig.add_trace(go.Surface(x=x_earth, y=y_earth, z=z_earth, colorscale='Blues', showscale=False, opacity=0.4, name='Earth', hoverinfo='skip'))

    # 軌跡
    fig.add_trace(go.Scatter3d(x=cx, y=cy, z=cz, mode='lines', line=dict(color='cyan', width=4), name='Chaser Orbit'))
    fig.add_trace(go.Scatter3d(x=tx, y=ty, z=tz, mode='lines', line=dict(color='orange', width=4), name='Target Orbit'))
    fig.add_trace(go.Scatter3d(x=trx, y=try_, z=trz, mode='lines', line=dict(color='red', width=6, dash='dash'), name=f'Optimized Transfer ({best_tof_hours:.1f}h)'))

    fig.add_trace(go.Scatter3d(x=[r_chaser_now[0].value], y=[r_chaser_now[1].value], z=[r_chaser_now[2].value], mode='markers', marker=dict(color='cyan', size=8, symbol='diamond'), name='Departure'))
    fig.add_trace(go.Scatter3d(x=[r_target_future[0].value], y=[r_target_future[1].value], z=[r_target_future[2].value], mode='markers', marker=dict(color='orange', size=8, symbol='cross'), name='Intercept'))

    fig.update_layout(
        title=dict(text=f"最佳化軌道會合 (TOF: {best_tof_hours:.2f}h, Δv: {best_total_dv:.2f} km/s)", font=dict(size=20), x=0.5),
        scene=dict(xaxis_title='X (km)', yaxis_title='Y (km)', zaxis_title='Z (km)', aspectmode='data'),
        margin=dict(l=0, r=0, b=0, t=50),
        legend=dict(x=0.02, y=0.98, bgcolor='rgba(255, 255, 255, 0.7)')
    )
    fig.show()

if __name__ == "__main__":
   lambert_problem_optimal()
