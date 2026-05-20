import numpy as np
from astropy import units as u
from poliastro.bodies import Earth
from poliastro.twobody import Orbit

# 填寫您想轉換的克卜勒軌道要素 (Keplerian Elements)
INPUT_KEPLERIAN = {
    "name": "Target Satellite",
    "a": 6971.0,      # 半長軸 Semi-major axis [km]
    "ecc": 0.0,       # 離心率 Eccentricity (0 為正圓)
    "inc": 65.0,      # 軌道傾角 Inclination [deg]
    "raan": 9.0,     # 升交點赤經 RAAN [deg]
    "argp": 0.0,      # 近心點幅角 Argument of perigee [deg]
    "nu": 180.0       # 真近點角 True anomaly (目前位置) [deg]
}

def convert_keplerian_to_eci(elements):
    # 1. 透過 poliastro 建立軌道物件
    orbit = Orbit.from_classical(
        attractor=Earth,
        a=elements["a"] * u.km,
        ecc=elements["ecc"] * u.one,
        inc=elements["inc"] * u.deg,
        raan=elements["raan"] * u.deg,
        argp=elements["argp"] * u.deg,
        nu=elements["nu"] * u.deg
    )
    
    # 2. 提取 ECI 坐標系下的位置 (r) 與速度 (v) 向量
    r_vec, v_vec = orbit.rv()
    
    # 將 astropy 的單位格式轉換為純數值陣列，並取到小數點後 6 位
    r_array = np.round(r_vec.to(u.km).value, 6)
    v_array = np.round(v_vec.to(u.km / u.s).value, 6)

    # 3. 輸出結果 (格式化為可直接貼上的 Python 字典與 GMAT 格式)
    print("\n" + "="*50)
    print(f"🔄 軌道參數轉換結果: {elements['name']}")
    print("="*50)
    
    print("\n [可直接貼入 Python CONFIG 字典的格式]")
    print(f'"{elements["name"].lower().replace(" ", "_")}": {{')
    print(f'    "r": [{r_array[0]}, {r_array[1]}, {r_array[2]}],')
    print(f'    "v": [{v_array[0]}, {v_array[1]}, {v_array[2]}],')
    print("},")
    
    print("\n [GMAT Cartesian 狀態向量輸入參考]")
    print(f"X  = {r_array[0]:>12.6f} km")
    print(f"Y  = {r_array[1]:>12.6f} km")
    print(f"Z  = {r_array[2]:>12.6f} km")
    print(f"VX = {v_array[0]:>12.6f} km/s")
    print(f"VY = {v_array[1]:>12.6f} km/s")
    print(f"VZ = {v_array[2]:>12.6f} km/s")
    print("="*50 + "\n")

if __name__ == "__main__":
    convert_keplerian_to_eci(INPUT_KEPLERIAN)
