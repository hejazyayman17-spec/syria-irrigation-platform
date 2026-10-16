"""NASA POWER → platform data sync (runs on GitHub Actions, outside Syria).

Why server-side: browsers in Syria often cannot reach power.larc.nasa.gov (geo/network
blocking) and file:// pages hit CORS limits. A US-hosted runner downloads the Syria grid,
computes FAO-56 ET0 per cell, and commits static JSON that the platform reads.

Outputs (data/nasa/):
  YYYY.json   — full daily archive for one year: every grid cell × every date × every variable + ET0
  latest.json — last date with complete ET0, per-cell values and per-governorate means (for the map)
  index.json  — available years and date range

Usage:
  python tools/nasa_power_sync.py                       # rolling update: last 20 days
  python tools/nasa_power_sync.py --start 20240101 --end 20241231
  python tools/nasa_power_sync.py --from-dir tests/nasa_mock   # offline test with saved responses
Standard library only (+ tools/fao56.py).
"""
import argparse, datetime as dt, json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from fao56 import et0_daily, elevation_from_pressure

BASE = 'https://power.larc.nasa.gov/api/temporal/daily/regional'
# Syria bounding box (regional endpoint accepts up to 10°×10°)
BBOX = dict(lat_min=32.0, lat_max=37.5, lon_min=35.5, lon_max=42.5)
PARAMS = ['T2M_MAX', 'T2M_MIN', 'T2M', 'T2MDEW', 'RH2M', 'ALLSKY_SFC_SW_DWN', 'WS2M', 'PS', 'PRECTOTCORR']
FILL = -999
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'nasa')
GOV_SRC = os.path.join(ROOT, 'data', 'syria_adm1_geoboundaries.geojson')
GOV_KEYS = {'Damascus': 'damascus', 'Rural Damascus': 'rif-dimashq', 'Aleppo': 'aleppo', 'Idleb': 'idlib',
            'Hama': 'hama', 'Homs': 'homs', 'Lattakia': 'latakia', 'Tartous': 'tartus', "Dar'a": 'daraa',
            'As-Sweida': 'suwayda', 'Quneitra': 'quneitra', 'Ar-Raqqa': 'raqqa', 'Deir-ez-Zor': 'deir-ez-zor',
            'Al-Hasakeh': 'hasakah'}


# ---------------------------------------------------------------- geometry
def load_governorates():
    fc = json.load(open(GOV_SRC, encoding='utf8'))
    out = []
    for f in fc['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        out.append((GOV_KEYS[f['properties']['shapeName']], polys))
    return out


def in_ring(x, y, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]; xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def gov_of(lon, lat, govs):
    for key, polys in govs:
        for poly in polys:
            if in_ring(lon, lat, poly[0]) and not any(in_ring(lon, lat, h) for h in poly[1:]):
                return key
    return None


# ---------------------------------------------------------------- download
def month_chunks(start, end):
    d = start
    while d <= end:
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield d, min(end, nxt - dt.timedelta(days=1))
        d = nxt


def fetch_json(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'GCSAR-Syria-Irrigation-Platform/0.6'})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode('utf8'))
        except Exception as e:  # 429/5xx/timeouts: back off and retry
            body = getattr(e, 'read', lambda: b'')()[:400]
            print(f'  ! attempt {k + 1}: {e} {body!r}', flush=True)
            time.sleep(10 * (k + 1))
    raise RuntimeError(f'NASA POWER failed after {tries} attempts: {url}')


def regional_url(param, a, b):
    q = {'parameters': param, 'community': 'AG', 'start': a.strftime('%Y%m%d'), 'end': b.strftime('%Y%m%d'),
         'format': 'JSON', 'time-standard': 'LST', 'latitude-min': BBOX['lat_min'], 'latitude-max': BBOX['lat_max'],
         'longitude-min': BBOX['lon_min'], 'longitude-max': BBOX['lon_max']}
    return BASE + '?' + urllib.parse.urlencode(q)


def parse_regional(js, param):
    """Regional JSON = GeoJSON FeatureCollection; each feature: geometry [lon, lat, (elev)],
    properties.parameter[param] = {YYYYMMDD: value}. Returns ({(lat,lon): {date: v}}, elev map, units)."""
    if 'features' not in js:
        raise RuntimeError(f'{param}: unexpected response: {json.dumps(js)[:400]}')
    units = (js.get('parameters') or {}).get(param, {}).get('units', '')
    series, elev = {}, {}
    for f in js['features']:
        c = f['geometry']['coordinates']
        key = (round(c[1], 4), round(c[0], 4))
        if len(c) > 2 and c[2] not in (None, FILL):
            elev[key] = c[2]
        vals = f['properties']['parameter'][param]
        conv = 3.6 if (param == 'ALLSKY_SFC_SW_DWN' and 'kw' in units.lower()) else 1.0  # AG → already MJ m-2 d-1
        series[key] = {d: (None if v is None or v <= FILL + 1 else round(v * conv, 3)) for d, v in vals.items()}
    return series, elev, units


def download(start, end, from_dir=None):
    data, elev, units = {p: {} for p in PARAMS}, {}, {}
    for p in PARAMS:
        for a, b in month_chunks(start, end):
            if from_dir:
                js = json.load(open(os.path.join(from_dir, f'{p}_{a:%Y%m}.json')))
            else:
                print(f'GET {p} {a:%Y-%m-%d}..{b:%Y-%m-%d}', flush=True)
                js = fetch_json(regional_url(p, a, b))
                time.sleep(1.5)  # be polite to the public API
            s, e, u = parse_regional(js, p)
            units[p] = u
            elev.update(e)
            for cell, dv in s.items():
                data[p].setdefault(cell, {}).update(dv)
    return data, elev, units


# ---------------------------------------------------------------- archive
def load_year(y):
    path = os.path.join(OUT, f'{y}.json')
    return json.load(open(path)) if os.path.exists(path) else None


def merge_and_compute(data, elev, units):
    govs = load_governorates()
    cells = sorted({c for p in PARAMS for c in data[p]})
    dates = sorted({d for p in PARAMS for c in data[p] for d in data[p][c]})
    by_year = {}
    for d in dates:
        by_year.setdefault(int(d[:4]), []).append(d)
    for y, ydates in by_year.items():
        arch = load_year(y) or {'year': y, 'cells': [], 'dates': [], 'vars': {}}
        cidx = {(c[0], c[1]): i for i, c in enumerate(arch['cells'])}
        for c in cells:
            if c not in cidx:
                cidx[c] = len(arch['cells'])
                arch['cells'].append([c[0], c[1], elev.get(c), gov_of(c[1], c[0], govs)])
        all_dates = sorted(set(arch['dates']) | set(ydates))
        old_pos = {d: i for i, d in enumerate(arch['dates'])}
        nvars = {}
        for v in PARAMS + ['ET0']:
            old = arch['vars'].get(v, [])
            grid = []
            for ci in range(len(arch['cells'])):
                row = old[ci] if ci < len(old) else []
                grid.append([row[old_pos[d]] if d in old_pos and old_pos[d] < len(row) else None for d in all_dates])
            nvars[v] = grid
        for c in cells:
            ci = cidx[c]
            for d in ydates:
                j = all_dates.index(d)
                for p in PARAMS:
                    val = data[p].get(c, {}).get(d)
                    if val is not None:
                        nvars[p][ci][j] = val
        # ET0 per cell/date (recomputed for every date touched)
        for ci, cell in enumerate(arch['cells']):
            z = cell[2]
            if z is None:
                ps = [x for x in nvars['PS'][ci] if x is not None]
                z = round(elevation_from_pressure(sum(ps) / len(ps)), 1) if ps else None
                cell[2] = z
            for j, d in enumerate(all_dates):
                g = lambda p: nvars[p][ci][j]
                doy = dt.date(int(d[:4]), int(d[4:6]), int(d[6:])).timetuple().tm_yday
                et, _ = et0_daily(tmin=g('T2M_MIN'), tmax=g('T2M_MAX'), u=g('WS2M'), rs=g('ALLSKY_SFC_SW_DWN'),
                                  elev=z, lat=cell[0], doy=doy, tdew=g('T2MDEW'), rhmean=g('RH2M'))
                nvars['ET0'][ci][j] = None if et is None else round(et, 2)
        arch.update(dates=all_dates, vars=nvars,
                    source='NASA POWER daily regional, community AG, time-standard LST',
                    units={**{p: units.get(p, '') for p in PARAMS}, 'ET0': 'mm/day (FAO-56 PM, Tdew path)'},
                    cell_fields=['lat', 'lon', 'elev_m', 'gov'],
                    updated=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f'{y}.json'), 'w') as f:
            json.dump(arch, f, separators=(',', ':'))
        print(f'wrote {y}.json: {len(arch["cells"])} cells × {len(all_dates)} days')


def write_latest():
    years = sorted(int(n[:4]) for n in os.listdir(OUT) if n[:4].isdigit() and n.endswith('.json'))
    arch = load_year(years[-1])
    et = arch['vars']['ET0']
    inside = [i for i, c in enumerate(arch['cells']) if c[3]]
    # latest date where ≥80% of Syrian cells have ET0 (solar radiation lags several days)
    j = next((j for j in range(len(arch['dates']) - 1, -1, -1)
              if sum(et[i][j] is not None for i in inside) >= 0.8 * len(inside)), None)
    if j is None:
        print('no complete date yet'); return
    govs = {}
    for i in inside:
        if et[i][j] is not None:
            govs.setdefault(arch['cells'][i][3], []).append(et[i][j])
    # governorates smaller than one POWER cell (≈0.5°×0.625°: Damascus, Latakia, Tartus, …) contain no cell
    # centre → use the nearest valid cell to the governorate's centroid, and flag it (n = 0, method = nearest)
    method = {k: 'cells-inside' for k in govs}
    for key, polys in load_governorates():
        if key in govs:
            continue
        ring = max((poly[0] for poly in polys), key=len)
        cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
        best = min((i for i in range(len(arch['cells'])) if et[i][j] is not None),
                   key=lambda i: (arch['cells'][i][0] - cy) ** 2 + ((arch['cells'][i][1] - cx) * 0.82) ** 2)
        govs[key], method[key] = [et[best][j]], 'nearest-cell'
    latest = {'date': arch['dates'][j], 'updated': arch['updated'], 'source': arch['source'],
              'cells': [[c[0], c[1], c[3], et[i][j]] for i, c in enumerate(arch['cells'])],
              'governorates': {k: {'et0': round(sum(v) / len(v), 2), 'n': len(v) if method[k] == 'cells-inside' else 0,
                                   'method': method[k]} for k, v in govs.items()},
              'last_any_date': arch['dates'][-1]}
    json.dump(latest, open(os.path.join(OUT, 'latest.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    first = load_year(years[0])
    json.dump({'years': years, 'first_date': first['dates'][0], 'last_date': arch['dates'][-1],
               'complete_et0_date': latest['date'], 'params': PARAMS},
              open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
    print('latest complete ET0 date:', latest['date'], '| governorates:', len(govs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start'); ap.add_argument('--end'); ap.add_argument('--from-dir')
    a = ap.parse_args()
    today = dt.date.today()
    end = dt.datetime.strptime(a.end, '%Y%m%d').date() if a.end else today - dt.timedelta(days=1)
    start = dt.datetime.strptime(a.start, '%Y%m%d').date() if a.start else end - dt.timedelta(days=19)
    print(f'Sync {start} → {end}')
    data, elev, units = download(start, end, a.from_dir)
    print('units:', units)
    merge_and_compute(data, elev, units)
    write_latest()


if __name__ == '__main__':
    main()
