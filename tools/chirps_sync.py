"""CHIRPS v3.0 monthly rain over Syria → data/rain/chirps/YYYY.json (runs on GitHub Actions — needs internet + rasterio).

Why: NASA POWER daily rain (PRECTOTCORR) under-reads western Syria by 12–42 % and produced a spurious 2025/26 rain year
in the east (Deir ez-Zor 3.7× its median). Against ten reference stations (1995–2022, tools/rain_eval) CHIRPS monthly
totals cut the rain-year bias from −17 % to +6 % (RMSE 184 → 137 mm). The platform keeps NASA's daily TIMING and scales
each month to the CHIRPS total at the site (js/rain.js): P_day = P_NASA,day × CHIRPS_month / NASA_month.

Grid: CHIRPS 0.05° pixels averaged to 0.1° boxes (2×2 pixels; ocean/no-data pixels ignored) over the platform bbox.
File:  {year, grid:{lat0, lon0, step, nlat, nlon}, months:['YYYY-MM',…], v:[[box values in 0.1 mm, row-major from lat0/lon0; -1 = no data], …],
        source, updated}
Only months not yet stored are read (point reads over HTTP range requests, ~1 MB per month). Final monthly CHIRPS is
published about 3–5 weeks after the month ends; until then the platform keeps raw NASA for that month (marked provisional).
Usage: python tools/chirps_sync.py [--from 2021-01]
"""
import argparse, datetime as dt, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'rain', 'chirps')
BBOX = dict(lat_min=32.0, lat_max=37.5, lon_min=35.5, lon_max=42.5)   # same box as tools/nasa_power_sync.py
STEP = 0.1
URL = 'https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.{y}.{m:02d}.tif'


def read_month(y, m):
    """0.1° box means over the bbox for one month, or None when the file is not published yet."""
    import numpy as np, rasterio
    from rasterio.windows import from_bounds
    path = '/vsicurl/' + URL.format(y=y, m=m)
    for k in range(3):
        try:
            with rasterio.Env(GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='5', GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR'):
                with rasterio.open(path) as ds:
                    win = from_bounds(BBOX['lon_min'], BBOX['lat_min'], BBOX['lon_max'], BBOX['lat_max'], ds.transform).round_offsets().round_lengths()
                    a = ds.read(1, window=win).astype('float64')
                    t = ds.window_transform(win)
                    nod = ds.nodata
            break
        except Exception as e:
            msg = str(e)
            if '404' in msg or 'does not exist' in msg or 'No such file' in msg:
                return None
            print(f'  {y}-{m:02d} try {k + 1}: {msg[:120]}', flush=True); time.sleep(5 * (k + 1))
    else:
        return None
    a[(a < 0) | (a == nod)] = np.nan
    # pixel centres → 0.1° boxes anchored at the bbox corner
    lat0, lon0 = BBOX['lat_min'], BBOX['lon_min']
    nlat, nlon = round((BBOX['lat_max'] - lat0) / STEP), round((BBOX['lon_max'] - lon0) / STEP)
    s, c = np.zeros((nlat, nlon)), np.zeros((nlat, nlon))
    rows, cols = a.shape
    for r in range(rows):
        lat = t.f + (r + 0.5) * t.e
        i = int((lat - lat0) // STEP)
        if not 0 <= i < nlat: continue
        for q in range(cols):
            v = a[r, q]
            if v != v: continue
            lon = t.c + (q + 0.5) * t.a
            j = int((lon - lon0) // STEP)
            if 0 <= j < nlon: s[i, j] += v; c[i, j] += 1
    out = [int(round(10 * s[i, j] / c[i, j])) if c[i, j] else -1 for i in range(nlat) for j in range(nlon)]
    return out, dict(lat0=lat0, lon0=lon0, step=STEP, nlat=nlat, nlon=nlon)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--from', dest='frm', default='2021-01'); a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    y, m = map(int, a.frm.split('-'))
    today = dt.date.today(); changed = set()
    files = {}
    while (y, m) < (today.year, today.month):
        f = files.get(y)
        if f is None:
            p = os.path.join(OUT, f'{y}.json')
            f = files[y] = json.load(open(p)) if os.path.exists(p) else {'year': y, 'months': [], 'v': []}
        key = f'{y}-{m:02d}'
        if key not in f['months']:
            r = read_month(y, m)
            if r is None:
                print('  not published yet:', key); break          # later months cannot exist either
            vals, grid = r
            f['grid'] = grid; f['months'].append(key); f['v'].append(vals); changed.add(y)
            print('  CHIRPS', key, flush=True)
        m += 1
        if m > 12: y, m = y + 1, 1
    for y in sorted(changed):
        f = files[y]
        order = sorted(range(len(f['months'])), key=lambda k: f['months'][k])
        f['months'] = [f['months'][k] for k in order]; f['v'] = [f['v'][k] for k in order]
        f['source'] = 'CHIRPS v3.0 monthly (UCSB Climate Hazards Center), 0.05° pixels averaged to 0.1° boxes'
        f['updated'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
        json.dump(f, open(os.path.join(OUT, f'{y}.json'), 'w'), separators=(',', ':'))
        print(f'wrote {y}.json: {len(f["months"])} months')
    years = sorted(int(n[:4]) for n in os.listdir(OUT) if n[:4].isdigit())
    last = max((m for y in years for m in json.load(open(os.path.join(OUT, f'{y}.json')))['months']), default=None)
    json.dump({'years': years, 'last_month': last}, open(os.path.join(OUT, 'index.json'), 'w'))


if __name__ == '__main__':
    main()
