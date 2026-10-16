"""Synthetic NASA POWER regional responses (same JSON shape) for offline pipeline tests."""
import json, os, sys, math, datetime as dt
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
lats = [32.25 + 0.5 * i for i in range(11)]; lons = [35.625 + 0.625 * i for i in range(12)]
start, end = dt.date(2026, 9, 20), dt.date(2026, 10, 9)
base = dict(T2M_MAX=32, T2M_MIN=16, T2M=24, T2MDEW=8, RH2M=40, ALLSKY_SFC_SW_DWN=20, WS2M=2.5, PS=95, PRECTOTCORR=0)
units = dict(ALLSKY_SFC_SW_DWN='MJ/m^2/day')
for p, v0 in base.items():
    for m in (9, 10):
        a = max(start, dt.date(2026, m, 1)); b = min(end, dt.date(2026, m + 1, 1) - dt.timedelta(days=1))
        feats = []
        for la in lats:
            for lo in lons:
                vals = {}
                d = a
                while d <= b:
                    v = v0 + (lo - 38) * 0.4 if p.startswith('T2M') else v0
                    if p == 'ALLSKY_SFC_SW_DWN' and d > end - dt.timedelta(days=4): v = -999  # solar lag
                    vals[d.strftime('%Y%m%d')] = round(v, 2); d += dt.timedelta(days=1)
                feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lo, la, 400.0]},
                              'properties': {'parameter': {p: vals}}})
        json.dump({'type': 'FeatureCollection', 'parameters': {p: {'units': units.get(p, '')}}, 'features': feats},
                  open(f'{out}/{p}_2026{m:02d}.json', 'w'))
