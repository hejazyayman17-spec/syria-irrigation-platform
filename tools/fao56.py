"""FAO-56 Penman–Monteith reference ET0 (daily) — Python twin of calcET0() in index.html.

Same equations and same humidity priority as the browser engine, so server-computed
NASA grids and browser-computed station series are directly comparable.
Equation numbers refer to Allen et al. (1998), FAO Irrigation & Drainage Paper 56.
"""
import math

SIGMA = 4.903e-9  # Stefan–Boltzmann, MJ K-4 m-2 day-1


def e0(t):
    """Saturation vapour pressure at T [kPa] — Eq. 11."""
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def wind2m(u, z):
    """Log wind profile to 2 m — Eq. 47."""
    if z is None or z <= 0 or abs(z - 2) < 0.01:
        return u
    return u * 4.87 / math.log(67.8 * z - 5.42)


def et0_daily(tmin, tmax, u, rs, elev, lat, doy, rhmin=None, rhmax=None, tdew=None, rhmean=None, wind_h=2.0):
    """Return (et0 mm/day, humidity_method) or (None, reason). G = 0 for daily steps (Eq. 42)."""
    if None in (tmin, tmax, u, rs, elev, lat, doy):
        return None, 'missing core input'
    t = (tmin + tmax) / 2                                   # Eq. 9
    es = (e0(tmax) + e0(tmin)) / 2                          # Eq. 12
    if rhmin is not None and rhmax is not None:             # Eq. 17
        ea, hm = (e0(tmin) * rhmax / 100 + e0(tmax) * rhmin / 100) / 2, 'RHmin/RHmax'
    elif tdew is not None:                                  # Eq. 14
        ea, hm = e0(tdew), 'Tdew'
    elif rhmean is not None:                                # Eq. 19
        ea, hm = es * rhmean / 100, 'RHmean'
    else:
        return None, 'humidity missing'
    delta = 4098 * e0(t) / (t + 237.3) ** 2                 # Eq. 13
    p = 101.3 * ((293 - 0.0065 * elev) / 293) ** 5.26       # Eq. 7
    gamma = 0.000665 * p                                    # Eq. 8
    phi = math.radians(lat)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)      # Eq. 23
    sd = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)   # Eq. 24
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(sd))))  # Eq. 25
    ra = (24 * 60 / math.pi) * 0.0820 * dr * (ws * math.sin(phi) * math.sin(sd)
                                              + math.cos(phi) * math.cos(sd) * math.sin(ws))  # Eq. 21
    rso = (0.75 + 2e-5 * elev) * ra                         # Eq. 37
    rns = 0.77 * rs                                         # Eq. 38, albedo 0.23
    ratio = max(0.0, min(1.0, rs / rso)) if rso > 0 else 1.0
    cloud = max(0.05, min(1.0, 1.35 * ratio - 0.35))
    rnl = SIGMA * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * math.sqrt(max(ea, 0))) * cloud  # Eq. 39
    rn = rns - rnl                                          # Eq. 40
    u2 = wind2m(u, wind_h)
    et = (0.408 * delta * rn + gamma * (900 / (t + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))  # Eq. 6
    return max(0.0, et), hm


def elevation_from_pressure(p_kpa):
    """Invert Eq. 7 — used when the grid cell has no elevation attribute."""
    if p_kpa is None or p_kpa <= 0:
        return None
    return (293 / 0.0065) * (1 - (p_kpa / 101.3) ** (1 / 5.26))


if __name__ == '__main__':
    # FAO-56 Example 18: Uccle (Brussels), 6 July, lat 50°48'N, z = 100 m → ET0 = 3.9 mm/day
    et, hm = et0_daily(tmin=12.3, tmax=21.5, u=2.078, rs=22.07, elev=100, lat=50.8, doy=187, rhmin=63, rhmax=84)
    print(f'FAO-56 Example 18: ET0 = {et:.2f} mm/day ({hm}) — published 3.9')
    assert abs(et - 3.9) < 0.06
