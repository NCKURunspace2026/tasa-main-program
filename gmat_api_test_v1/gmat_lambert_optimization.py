#!/usr/bin/env python3
"""
GMAT Lambert Rendezvous via Differential Corrector (Method 3)
3-Burn Multi-Impulse with RungeKutta89 & JGM-3 8x8

Physics: JGM-3 8x8 (full consistency with GMAT)
Solver:  GMAT's own Differential Corrector
          1. Python UV solver provides initial guess
          2. Write .script with Target Sequence (3-Burn)
          3. Load and execute via GMAT API (RunScript + Execute)
          4. Read converged solution back
"""

import sys, os
import numpy as np

GMAT_BIN = r"C:\Users\jaspe\Downloads\gmat-win-R2026a\bin"
GMAT_API = r"C:\Users\jaspe\Downloads\gmat-win-R2026a\api"
sys.path.insert(1, GMAT_BIN)
sys.path.insert(1, os.path.join(os.path.dirname(__file__)))
os.chdir(GMAT_BIN)
from load_gmat import *

MU = 398600.4418

CHASER_R0 = np.array([6778.14, 0, 0.0])
CHASER_V0 = np.array([0, 7.6725, 0])
TARGET_R0 = np.array([26578.14, 0, 0.0])
TARGET_V0 = np.array([0, 2.7388, 2.7388])


# ============================================================
#  Python UV solver (fast initial guess)
# ============================================================
def stumpC(z):
    if z > 1e-8:
        sz = np.sqrt(z)
        return (1 - np.cos(sz)) / z
    elif z < -1e-8:
        sz = np.sqrt(-z)
        return (np.cosh(sz) - 1) / (-z)
    return 1/2 - z/24 + z**2/720 - z**3/40320


def stumpS(z):
    if z > 1e-8:
        sz = np.sqrt(z)
        return (sz - np.sin(sz)) / sz**3
    elif z < -1e-8:
        sz = np.sqrt(-z)
        return (np.sinh(sz) - sz) / sz**3
    return 1/6 - z/120 + z**2/5040 - z**3/362880


def propagate_uv(r0, v0, dt, mu):
    r0n = np.linalg.norm(r0)
    vr0 = np.dot(r0, v0) / r0n
    alpha = 2 / r0n - np.dot(v0, v0) / mu
    chi = np.sqrt(mu) * abs(alpha) * dt if abs(alpha) > 1e-12 else 0.0
    for _ in range(100):
        z = alpha * chi**2
        C = stumpC(z); S = stumpS(z)
        F = r0n * vr0 / np.sqrt(mu) * chi**2 * C \
            + (1 - alpha * r0n) * chi**3 * S + r0n * chi - np.sqrt(mu) * dt
        dF = r0n * vr0 / np.sqrt(mu) * chi * (1 - z * S) \
             + (1 - alpha * r0n) * chi**2 * C + r0n
        dchi = F / dF; chi -= dchi
        if abs(dchi) < 1e-10: break
    z = alpha * chi**2; C = stumpC(z); S = stumpS(z)
    f = 1 - chi**2 / r0n * C; g = dt - chi**3 / np.sqrt(mu) * S
    r = f * r0 + g * v0; rn = np.linalg.norm(r)
    fdot = np.sqrt(mu) / (rn * r0n) * (alpha * chi**3 * S - chi)
    gdot = 1 - chi**2 / rn * C
    return r, fdot * r0 + gdot * v0


def solve_lambert(r1, r2, tof, mu, prograde=True):
    r1n, r2n = np.linalg.norm(r1), np.linalg.norm(r2)
    cos_dnu = np.clip(np.dot(r1, r2) / (r1n * r2n), -1, 1)
    cr = np.cross(r1, r2)
    sin_dnu = np.linalg.norm(cr) / (r1n * r2n)
    if (prograde and cr[2] < 0) or (not prograde and cr[2] >= 0):
        sin_dnu = -sin_dnu
    A = sin_dnu * np.sqrt(r1n * r2n / (1 - cos_dnu + 1e-15))
    z_lo, z_up, z = -4*np.pi**2, 4*np.pi**2, 0.0
    for _ in range(300):
        C, S = stumpC(z), stumpS(z)
        if C <= 0: z = 0.5*(z+z_up); continue
        y = r1n + r2n + A * ((z*S - 1) / np.sqrt(C))
        if y < 0: z = 0.5*(z+z_up); continue
        x = np.sqrt(y / C)
        F = (x**3 * S + A * np.sqrt(y)) / np.sqrt(mu) - tof
        if abs(F) < 1e-8: break
        if F > 0: z_up = z
        else: z_lo = z
        z = 0.5*(z_up+z_lo)
    C, S = stumpC(z), stumpS(z)
    y = r1n + r2n + A * ((z*S - 1) / np.sqrt(C))
    v1 = (r2 - (1 - y/r1n) * r1) / (A * np.sqrt(y/mu))
    v2 = ((1 - y/r2n) * r2 - r1) / (A * np.sqrt(y/mu))
    return v1, v2


def initial_guess():
    """3-Burn Lambert initial guess via Python UV solver.

    Returns (dv1, dv2, dv3, tof1_s, tof2_s).
    Split total TOF at ~40% for the mid-point impulse (dv2 starts at 0).
    """
    from scipy.optimize import minimize_scalar

    def cost(tof_h):
        tg_r, tg_v = propagate_uv(TARGET_R0, TARGET_V0, tof_h * 3600, MU)
        v1, v2 = solve_lambert(CHASER_R0, tg_r, tof_h * 3600, MU)
        return np.linalg.norm(v1 - CHASER_V0) + np.linalg.norm(tg_v - v2) + 0.2 * tof_h

    res = minimize_scalar(cost, bounds=(0.5, 12), method='bounded',
                          options={'xatol': 1e-8})

    total_tof_s = res.x * 3600
    tg_r, tg_v = propagate_uv(TARGET_R0, TARGET_V0, total_tof_s, MU)
    v1, v2 = solve_lambert(CHASER_R0, tg_r, total_tof_s, MU)
    dv1 = v1 - CHASER_V0
    dv3 = tg_v - v2
    dv2 = np.zeros(3)

    tof1_s = total_tof_s * 0.40
    tof2_s = total_tof_s * 0.60

    print(f"  TOF1     = {tof1_s:.2f} s  ({tof1_s/3600:.4f} h)")
    print(f"  TOF2     = {tof2_s:.2f} s  ({tof2_s/3600:.4f} h)")
    print(f"  DV1      = {np.round(dv1, 6)}")
    print(f"  DV2      = {np.round(dv2, 6)}  (mid-point, starts at 0)")
    print(f"  DV3      = {np.round(dv3, 6)}")
    print(f"  Total DV = {np.linalg.norm(dv1)+np.linalg.norm(dv2)+np.linalg.norm(dv3):.6f} km/s")

    return dv1, dv2, dv3, tof1_s, tof2_s


# ============================================================
#  GMAT script templates (ASCII only - no Chinese/special chars)
# ============================================================

# 2-Burn template (first pass: get close under JGM-3 8x8)
SCRIPT_TEMPLATE_2BURN = """%GMAT 2-Burn Lambert (warm-start for 3-Burn)
%  Integrator: RungeKutta89 | Gravity: JGM-3 8x8
Create Spacecraft Chaser;
GMAT Chaser.DateFormat = UTCGregorian;
GMAT Chaser.Epoch = '20 May 2026 12:00:00.000';
GMAT Chaser.CoordinateSystem = EarthMJ2000Eq;
GMAT Chaser.DisplayStateType = Cartesian;
GMAT Chaser.X = {cx:.6f};
GMAT Chaser.Y = {cy:.6f};
GMAT Chaser.Z = {cz:.6f};
GMAT Chaser.VX = {cvx:.6f};
GMAT Chaser.VY = {cvy:.6f};
GMAT Chaser.VZ = {cvz:.6f};
GMAT Chaser.DryMass = 1000;
GMAT Chaser.Cd = 2.2;
GMAT Chaser.Cr = 1.8;
GMAT Chaser.DragArea = 15;
GMAT Chaser.SRPArea = 1;
Create Spacecraft Tgt;
GMAT Tgt.DateFormat = UTCGregorian;
GMAT Tgt.Epoch = '20 May 2026 12:00:00.000';
GMAT Tgt.CoordinateSystem = EarthMJ2000Eq;
GMAT Tgt.DisplayStateType = Cartesian;
GMAT Tgt.X = {tx:.6f};
GMAT Tgt.Y = {ty:.6f};
GMAT Tgt.Z = {tz:.6f};
GMAT Tgt.VX = {tvx:.6f};
GMAT Tgt.VY = {tvy:.6f};
GMAT Tgt.VZ = {tvz:.6f};
GMAT Tgt.DryMass = 1000;
GMAT Tgt.Cd = 2.2;
GMAT Tgt.Cr = 1.8;
GMAT Tgt.DragArea = 15;
GMAT Tgt.SRPArea = 1;
Create ForceModel FM;
GMAT FM.CentralBody = Earth;
GMAT FM.Drag = None;
GMAT FM.SRP = Off;
GMAT FM.RelativisticCorrection = Off;
GMAT FM.GravityField.Earth.Degree = 8;
GMAT FM.GravityField.Earth.Order = 8;
GMAT FM.GravityField.Earth.PotentialFile = '../data/gravity/earth/JGM3.cof';
Create Propagator DefaultProp;
GMAT DefaultProp.FM = FM;
GMAT DefaultProp.Type = RungeKutta89;
GMAT DefaultProp.InitialStepSize = 60;
GMAT DefaultProp.Accuracy = 1e-13;
GMAT DefaultProp.MinStep = 0.001;
GMAT DefaultProp.MaxStep = 2700;
Create ImpulsiveBurn Burn1;
GMAT Burn1.CoordinateSystem = EarthMJ2000Eq;
GMAT Burn1.DecrementMass = false;
GMAT Burn1.Isp = 300;
GMAT Burn1.GravitationalAccel = 9.81;
Create ImpulsiveBurn Burn2;
GMAT Burn2.CoordinateSystem = EarthMJ2000Eq;
GMAT Burn2.DecrementMass = false;
GMAT Burn2.Isp = 300;
GMAT Burn2.GravitationalAccel = 9.81;
Create Variable dv1x;
Create Variable dv1y;
Create Variable dv1z;
Create Variable dv2x;
Create Variable dv2y;
Create Variable dv2z;
Create Variable tof_sec;
Create Variable dx;
Create Variable dy;
Create Variable dz;
GMAT dv1x = {dv1x:.6f};
GMAT dv1y = {dv1y:.6f};
GMAT dv1z = {dv1z:.6f};
GMAT dv2x = {dv2x:.6f};
GMAT dv2y = {dv2y:.6f};
GMAT dv2z = {dv2z:.6f};
GMAT tof_sec = {tof_sec:.4f};
Create DifferentialCorrector DC1;
GMAT DC1.ShowProgress = true;
GMAT DC1.MaximumIterations = 100;
GMAT DC1.ReportStyle = Normal;
BeginMissionSequence;
Target DC1;
    Vary DC1(dv1x = {dv1x:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(dv1y = {dv1y:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(dv1z = {dv1z:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(dv2x = {dv2x:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(dv2y = {dv2y:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(dv2z = {dv2z:.6f}, {{Perturbation = 0.01, Lower = -10, Upper = 10}});
    Vary DC1(tof_sec = {tof_sec:.4f}, {{Perturbation = 10, Lower = 1800, Upper = 43200}});
    Burn1.Element1 = dv1x;
    Burn1.Element2 = dv1y;
    Burn1.Element3 = dv1z;
    Maneuver Burn1(Chaser);
    Propagate DefaultProp(Chaser, Tgt) {{Chaser.ElapsedSecs = tof_sec}};
    Burn2.Element1 = dv2x;
    Burn2.Element2 = dv2y;
    Burn2.Element3 = dv2z;
    Maneuver Burn2(Chaser);
    dx = Chaser.X - Tgt.X;
    dy = Chaser.Y - Tgt.Y;
    dz = Chaser.Z - Tgt.Z;
    Achieve DC1(dx = 0, {{Tolerance = 1e-3}});
    Achieve DC1(dy = 0, {{Tolerance = 1e-3}});
    Achieve DC1(dz = 0, {{Tolerance = 1e-3}});
EndTarget;
"""

# 3-Burn template (second pass: split into 3 burns)
SCRIPT_TEMPLATE = """%GMAT 3-Burn Multi-Impulse Rendezvous (warm-started from 2-Burn)
%  Integrator: RungeKutta89 | Gravity: JGM-3 8x8
Create Spacecraft Chaser;
GMAT Chaser.DateFormat = UTCGregorian;
GMAT Chaser.Epoch = '20 May 2026 12:00:00.000';
GMAT Chaser.CoordinateSystem = EarthMJ2000Eq;
GMAT Chaser.DisplayStateType = Cartesian;
GMAT Chaser.X = {cx:.6f};
GMAT Chaser.Y = {cy:.6f};
GMAT Chaser.Z = {cz:.6f};
GMAT Chaser.VX = {cvx:.6f};
GMAT Chaser.VY = {cvy:.6f};
GMAT Chaser.VZ = {cvz:.6f};
GMAT Chaser.DryMass = 1000;
GMAT Chaser.Cd = 2.2;
GMAT Chaser.Cr = 1.8;
GMAT Chaser.DragArea = 15;
GMAT Chaser.SRPArea = 1;
Create Spacecraft Tgt;
GMAT Tgt.DateFormat = UTCGregorian;
GMAT Tgt.Epoch = '20 May 2026 12:00:00.000';
GMAT Tgt.CoordinateSystem = EarthMJ2000Eq;
GMAT Tgt.DisplayStateType = Cartesian;
GMAT Tgt.X = {tx:.6f};
GMAT Tgt.Y = {ty:.6f};
GMAT Tgt.Z = {tz:.6f};
GMAT Tgt.VX = {tvx:.6f};
GMAT Tgt.VY = {tvy:.6f};
GMAT Tgt.VZ = {tvz:.6f};
GMAT Tgt.DryMass = 1000;
GMAT Tgt.Cd = 2.2;
GMAT Tgt.Cr = 1.8;
GMAT Tgt.DragArea = 15;
GMAT Tgt.SRPArea = 1;
Create ForceModel FM;
GMAT FM.CentralBody = Earth;
GMAT FM.Drag = None;
GMAT FM.SRP = Off;
GMAT FM.RelativisticCorrection = Off;
GMAT FM.GravityField.Earth.Degree = 8;
GMAT FM.GravityField.Earth.Order = 8;
GMAT FM.GravityField.Earth.PotentialFile = '../data/gravity/earth/JGM3.cof';
Create Propagator DefaultProp;
GMAT DefaultProp.FM = FM;
GMAT DefaultProp.Type = RungeKutta89;
GMAT DefaultProp.InitialStepSize = 60;
GMAT DefaultProp.Accuracy = 1e-13;
GMAT DefaultProp.MinStep = 0.001;
GMAT DefaultProp.MaxStep = 2700;
Create ImpulsiveBurn Burn1;
GMAT Burn1.CoordinateSystem = EarthMJ2000Eq;
GMAT Burn1.DecrementMass = false;
GMAT Burn1.Isp = 300;
GMAT Burn1.GravitationalAccel = 9.81;
Create ImpulsiveBurn Burn2;
GMAT Burn2.CoordinateSystem = EarthMJ2000Eq;
GMAT Burn2.DecrementMass = false;
GMAT Burn2.Isp = 300;
GMAT Burn2.GravitationalAccel = 9.81;
Create ImpulsiveBurn Burn3;
GMAT Burn3.CoordinateSystem = EarthMJ2000Eq;
GMAT Burn3.DecrementMass = false;
GMAT Burn3.Isp = 300;
GMAT Burn3.GravitationalAccel = 9.81;
Create Variable dv1x;
Create Variable dv1y;
Create Variable dv1z;
Create Variable dv2x;
Create Variable dv2y;
Create Variable dv2z;
Create Variable dv3x;
Create Variable dv3y;
Create Variable dv3z;
Create Variable tof1_sec;
Create Variable tof2_sec;
Create Variable dx;
Create Variable dy;
Create Variable dz;
Create Variable dvx;
Create Variable dvy;
Create Variable dvz;
GMAT dv1x = {dv1x:.6f};
GMAT dv1y = {dv1y:.6f};
GMAT dv1z = {dv1z:.6f};
GMAT dv2x = {dv2x:.6f};
GMAT dv2y = {dv2y:.6f};
GMAT dv2z = {dv2z:.6f};
GMAT dv3x = {dv3x:.6f};
GMAT dv3y = {dv3y:.6f};
GMAT dv3z = {dv3z:.6f};
GMAT tof1_sec = {tof1_sec:.4f};
GMAT tof2_sec = {tof2_sec:.4f};
Create DifferentialCorrector DC1;
GMAT DC1.ShowProgress = true;
GMAT DC1.MaximumIterations = 300;
GMAT DC1.ReportStyle = Normal;
BeginMissionSequence;
Target DC1;
    Vary DC1(dv2x = {dv2x:.6f}, {{Perturbation = 0.001, Lower = -1, Upper = 1}});
    Vary DC1(dv2y = {dv2y:.6f}, {{Perturbation = 0.001, Lower = -1, Upper = 1}});
    Vary DC1(dv2z = {dv2z:.6f}, {{Perturbation = 0.001, Lower = -1, Upper = 1}});
    Vary DC1(dv3x = {dv3x:.6f}, {{Perturbation = 0.001, Lower = -15, Upper = 15}});
    Vary DC1(dv3y = {dv3y:.6f}, {{Perturbation = 0.001, Lower = -15, Upper = 15}});
    Vary DC1(dv3z = {dv3z:.6f}, {{Perturbation = 0.001, Lower = -15, Upper = 15}});
    Burn1.Element1 = {dv1x:.6f};
    Burn1.Element2 = {dv1y:.6f};
    Burn1.Element3 = {dv1z:.6f};
    Maneuver Burn1(Chaser);
    Propagate DefaultProp(Chaser, Tgt) {{Chaser.ElapsedSecs = tof1_sec}};
    Burn2.Element1 = dv2x;
    Burn2.Element2 = dv2y;
    Burn2.Element3 = dv2z;
    Maneuver Burn2(Chaser);
    Propagate DefaultProp(Chaser, Tgt) {{Chaser.ElapsedSecs = tof2_sec}};
    Burn3.Element1 = dv3x;
    Burn3.Element2 = dv3y;
    Burn3.Element3 = dv3z;
    Maneuver Burn3(Chaser);
    dx = Chaser.X - Tgt.X;
    dy = Chaser.Y - Tgt.Y;
    dz = Chaser.Z - Tgt.Z;
    dvx = Chaser.VX - Tgt.VX;
    dvy = Chaser.VY - Tgt.VY;
    dvz = Chaser.VZ - Tgt.VZ;
    Achieve DC1(dx = 0, {{Tolerance = 1e-3}});
    Achieve DC1(dy = 0, {{Tolerance = 1e-3}});
    Achieve DC1(dz = 0, {{Tolerance = 1e-3}});
    Achieve DC1(dvx = 0, {{Tolerance = 1e-6}});
    Achieve DC1(dvy = 0, {{Tolerance = 1e-6}});
    Achieve DC1(dvz = 0, {{Tolerance = 1e-6}});
EndTarget;
"""


def _write_script(template, filepath, **kwargs):
    content = template.format(**kwargs)
    content_ascii = content.encode('ascii', errors='ignore').decode('ascii')
    with open(filepath, 'w', encoding='ascii') as f:
        f.write(content_ascii)
    return content_ascii


def _run_gmat(filepath):
    """Load a script, run it, return (success, get_var_fn) where get_var_fn reads Variables."""
    gmat.Clear()
    ok = gmat.LoadScript(filepath)
    if not ok:
        return False, None
    ret = gmat.RunScript()
    if not ret:
        return False, None

    def get_var(name):
        obj = gmat.GetRuntimeObject(name)
        return float(obj.GetRealParameter("Value"))
    return True, get_var


def run_2burn_dc(script_path):
    """Run 2-burn DC under JGM-3 8x8.
    Returns (dv1, dv2, tof_s) or None on failure.
    """
    dv1_guess, dv2_guess, tof_s = initial_guess_2burn()

    _write_script(SCRIPT_TEMPLATE_2BURN, script_path,
        cx=CHASER_R0[0], cy=CHASER_R0[1], cz=CHASER_R0[2],
        cvx=CHASER_V0[0], cvy=CHASER_V0[1], cvz=CHASER_V0[2],
        tx=TARGET_R0[0], ty=TARGET_R0[1], tz=TARGET_R0[2],
        tvx=TARGET_V0[0], tvy=TARGET_V0[1], tvz=TARGET_V0[2],
        dv1x=dv1_guess[0], dv1y=dv1_guess[1], dv1z=dv1_guess[2],
        dv2x=dv2_guess[0], dv2y=dv2_guess[1], dv2z=dv2_guess[2],
        tof_sec=tof_s,
    )

    ok, get_var = _run_gmat(script_path)
    if not ok:
        return None

    dv1 = np.array([get_var("dv1x"), get_var("dv1y"), get_var("dv1z")])
    dv2 = np.array([get_var("dv2x"), get_var("dv2y"), get_var("dv2z")])
    tof = get_var("tof_sec")

    chaser = gmat.GetRuntimeObject("Chaser")
    target = gmat.GetRuntimeObject("Tgt")
    r_ch = np.array([chaser.GetRealParameter(p) for p in ("X", "Y", "Z")])
    r_tg = np.array([target.GetRealParameter(p) for p in ("X", "Y", "Z")])
    miss = np.linalg.norm(r_ch - r_tg)

    print(f"\n  2-Burn DC result:")
    print(f"    TOF       = {tof:.4f} s  ({tof/3600:.4f} h)")
    print(f"    DV1       = [{dv1[0]:.6f}, {dv1[1]:.6f}, {dv1[2]:.6f}] km/s")
    print(f"    DV2       = [{dv2[0]:.6f}, {dv2[1]:.6f}, {dv2[2]:.6f}] km/s")
    print(f"    Miss dist = {miss:.6f} km  ({'CONVERGED' if miss < 0.01 else 'NOT CONVERGED'})")

    return dv1, dv2, tof


def run_3burn_dc(dv1_init, dv2_init, dv3_init, tof1_init, tof2_init, script_path):
    """Run 3-burn DC with warm-start from 2-burn solution."""
    _write_script(SCRIPT_TEMPLATE, script_path,
        cx=CHASER_R0[0], cy=CHASER_R0[1], cz=CHASER_R0[2],
        cvx=CHASER_V0[0], cvy=CHASER_V0[1], cvz=CHASER_V0[2],
        tx=TARGET_R0[0], ty=TARGET_R0[1], tz=TARGET_R0[2],
        tvx=TARGET_V0[0], tvy=TARGET_V0[1], tvz=TARGET_V0[2],
        dv1x=dv1_init[0], dv1y=dv1_init[1], dv1z=dv1_init[2],
        dv2x=dv2_init[0], dv2y=dv2_init[1], dv2z=dv2_init[2],
        dv3x=dv3_init[0], dv3y=dv3_init[1], dv3z=dv3_init[2],
        tof1_sec=tof1_init,
        tof2_sec=tof2_init,
    )

    ok, get_var = _run_gmat(script_path)
    if not ok:
        return None

    dv1 = np.array([get_var("dv1x"), get_var("dv1y"), get_var("dv1z")])
    dv2 = np.array([get_var("dv2x"), get_var("dv2y"), get_var("dv2z")])
    dv3 = np.array([get_var("dv3x"), get_var("dv3y"), get_var("dv3z")])
    tof1 = get_var("tof1_sec")
    tof2 = get_var("tof2_sec")

    chaser = gmat.GetRuntimeObject("Chaser")
    target = gmat.GetRuntimeObject("Tgt")
    r_ch = np.array([chaser.GetRealParameter(p) for p in ("X", "Y", "Z")])
    r_tg = np.array([target.GetRealParameter(p) for p in ("X", "Y", "Z")])
    v_ch = np.array([chaser.GetRealParameter(p) for p in ("VX", "VY", "VZ")])
    v_tg = np.array([target.GetRealParameter(p) for p in ("VX", "VY", "VZ")])
    miss = np.linalg.norm(r_ch - r_tg)
    v_miss = np.linalg.norm(v_ch - v_tg)

    dv_total = np.linalg.norm(dv1) + np.linalg.norm(dv2) + np.linalg.norm(dv3)

    print(f"\n  3-Burn DC result (warm-started from 2-Burn):")
    print(f"    TOF1      = {tof1:.4f} s  ({tof1/3600:.4f} h)")
    print(f"    TOF2      = {tof2:.4f} s  ({tof2/3600:.4f} h)")
    print(f"    DV1       = [{dv1[0]:.6f}, {dv1[1]:.6f}, {dv1[2]:.6f}] km/s")
    print(f"    DV2       = [{dv2[0]:.6f}, {dv2[1]:.6f}, {dv2[2]:.6f}] km/s")
    print(f"    DV3       = [{dv3[0]:.6f}, {dv3[1]:.6f}, {dv3[2]:.6f}] km/s")
    print(f"    Total DV  = {dv_total:.6f} km/s")
    print(f"    Miss pos  = {miss:.6f} km  ({'CONVERGED' if miss < 0.01 else 'NOT CONVERGED'})")
    print(f"    Miss vel  = {v_miss:.6f} km/s")

    return dv1, dv2, dv3, tof1, tof2, miss, v_miss


def initial_guess_2burn():
    """2-Burn Lambert initial guess via Python UV solver.
    Returns (dv1, dv2, tof_s).
    """
    from scipy.optimize import minimize_scalar

    def cost(tof_h):
        tg_r, tg_v = propagate_uv(TARGET_R0, TARGET_V0, tof_h * 3600, MU)
        v1, v2 = solve_lambert(CHASER_R0, tg_r, tof_h * 3600, MU)
        return np.linalg.norm(v1 - CHASER_V0) + np.linalg.norm(tg_v - v2) + 0.2 * tof_h

    res = minimize_scalar(cost, bounds=(0.5, 12), method='bounded',
                          options={'xatol': 1e-8})

    total_tof_s = res.x * 3600
    tg_r, tg_v = propagate_uv(TARGET_R0, TARGET_V0, total_tof_s, MU)
    v1, v2 = solve_lambert(CHASER_R0, tg_r, total_tof_s, MU)
    dv1 = v1 - CHASER_V0
    dv2 = tg_v - v2

    print(f"  2-Burn initial guess:")
    print(f"    TOF       = {total_tof_s:.2f} s  ({total_tof_s/3600:.4f} h)")
    print(f"    DV1       = {np.round(dv1, 6)}")
    print(f"    DV2       = {np.round(dv2, 6)}")
    print(f"    Total DV  = {np.linalg.norm(dv1)+np.linalg.norm(dv2):.6f} km/s")

    return dv1, dv2, total_tof_s


# ============================================================
#  Main
# ============================================================
def main():
    print("=" * 55)
    print("  GMAT 3-Burn Lambert Rendezvous (Differential Corrector)")
    print("  Integrator: RungeKutta89 | Gravity: JGM-3 8x8")
    print("  Strategy: 2-Burn DC warm-start -> 3-Burn refinement")
    print("=" * 55)

    script_path = os.path.join(GMAT_BIN, "lambert_dc.script")

    # ----- Pass 1: 2-Burn DC (converges to ~1 m under JGM-3 8x8) -----
    print("\n[Pass 1/2] 2-Burn Differential Corrector (JGM-3 8x8)...")
    result_2burn = run_2burn_dc(script_path)
    if result_2burn is None:
        print("  [ERROR] 2-Burn DC failed")
        return

    dv1_2b, dv2_2b, tof_2b = result_2burn

    # Convert 2-burn solution to 3-burn initial guess.
    # Use a short 2nd coast so the trajectory stays close to the 2-burn solution.
    # dv2 = 0 (tiny mid-course correction), dv3 = dv2_2b (final impulse).
    # Short tof2 (60 s) so the 3-burn is nearly a 2-burn.
    dv1 = dv1_2b
    dv2 = np.zeros(3)
    dv3 = dv2_2b
    tof2 = 60.0
    tof1 = tof_2b - tof2

    print(f"\n  Warm-start conversion -> 3-Burn initial guess:")
    print(f"    TOF1 = {tof1:.2f} s  TOF2 = {tof2:.2f} s")
    print(f"    DV1  = {np.round(dv1, 6)}")
    print(f"    DV2  = {np.round(dv2, 6)}  (mid-point, starts at 0)")
    print(f"    DV3  = {np.round(dv3, 6)}  (nearly 2-burn DV2)")

    # ----- Pass 2: 3-Burn DC (refine with mid-course impulse) -----
    print("\n[Pass 2/2] 3-Burn Differential Corrector (warm-started)...")
    result_3burn = run_3burn_dc(dv1, dv2, dv3, tof1, tof2, script_path)
    if result_3burn is None:
        print("  [ERROR] 3-Burn DC failed")
        return

    dv1_3b, dv2_3b, dv3_3b, tof1_3b, tof2_3b, miss, v_miss = result_3burn

    print("\n" + "=" * 55)
    print("  FINAL RESULT (3-Burn | RK89 | JGM-3 8x8)")
    print("=" * 55)
    print(f"  TOF1      = {tof1_3b:.4f} s  ({tof1_3b/3600:.4f} h)")
    print(f"  TOF2      = {tof2_3b:.4f} s  ({tof2_3b/3600:.4f} h)")
    print(f"  DV1       = [{dv1_3b[0]:.6f}, {dv1_3b[1]:.6f}, {dv1_3b[2]:.6f}] km/s")
    print(f"  DV2       = [{dv2_3b[0]:.6f}, {dv2_3b[1]:.6f}, {dv2_3b[2]:.6f}] km/s")
    print(f"  DV3       = [{dv3_3b[0]:.6f}, {dv3_3b[1]:.6f}, {dv3_3b[2]:.6f}] km/s")
    print(f"  Total DV  = {np.linalg.norm(dv1_3b)+np.linalg.norm(dv2_3b)+np.linalg.norm(dv3_3b):.6f} km/s")
    print(f"  Miss pos  = {miss:.6f} km  ({'CONVERGED' if miss < 0.01 else 'NOT CONVERGED'})")
    print(f"  Miss vel  = {v_miss:.6f} km/s")

    if miss < 0.01:
        print("\n  *** RENDEZVOUS ACHIEVED ***")
    else:
        print(f"\n  *** NOT CONVERGED (miss distance > 0.01 km = 10 m) ***")

    gmat.Clear()


if __name__ == "__main__":
    main()
