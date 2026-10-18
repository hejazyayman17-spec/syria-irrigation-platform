"""Open-Meteo forecast → platform data (runs on GitHub Actions, like the NASA sync).

Purpose: the root-zone balance needs weather AFTER the last complete NASA POWER day:
  1. a bridge over NASA's latency (solar radiation lags several days) — Open-Meteo `past_days`
     (model analysis of recent days), and
  2. the next 7 days — Open-Meteo forecast (best_match: ECMWF IFS / ICON / GFS blend for the region).
Weather is delivered on the SAME grid cells as the NASA archive so the browser can append it to a cell's series.

Daily aggregation (local day, Asia/Damascus):
  Tmax, Tmin       daily temperature_2m_max / _min                       [°C]
  RHmax, RHmin     max / min of hourly relative_humidity_2m               [%]   → FAO-56 Eq. 17 path
  u2               mean hourly wind_speed_10m (m/s) → 2 m by FAO-56 Eq. 47 [m/s]
  Rs               daily shortwave_radiation_sum                          [MJ m-2 day-1]
  rain, rainProb   daily precipitation_sum [mm], precipitation_probability_max [%]
ET0 is computed here with tools/fao56.py (same equations as the browser) and compared with
Open-Meteo's own et0_fao_evapotranspiration as a sanity check (printed in the log).

Output: data/forecast/latest.json
Usage:  python tools/forecast_sync.py            |  python tools/forecast_sync.py --from-file sample.json  (offline test)
"""
import argparse, datetime as dt, json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from fao56 import et0_daily, wind2m

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NASA = os.path.join(ROOT, 'data', 'nasa')
OUT = os.path.join(ROOT, 'data', 'forecast')
API = 'https://api.open-meteo.com/v1/forecast'
PAST_DAYS, FORECAST_DAYS, CHUNK = 14, 8, 40
HOURLY = ['relative_humidity_2m', 'wind_speed_10m']
DAILY = ['temperature_2m_max', 'temperature_2m_min', 'shortwave_radiation_sum', 'precipitation_sum',
         'precipitation_probability_max', 'et0_fao_evapotranspiration']


def grid_cells():
    """Cells of the newest NASA archive year: [lat, lon, elev_m, gov]"""
    years = sorted(int(n[:4]) for n in os.listdir(NASA) if n[:4].isdigit() and n.endswith('.json'))
    return json.load(open(os.path.join(NASA, f'{years[-1]}.json')))['cells']


def fetch(cells):
    q = {'latitude': ','.join(str(c[0]) for c in cells), 'longitude': ','.join(str(c[1]) for c in cells),
         'hourly': ','.join(HOURLY), 'daily': ','.join(DAILY), 'timezone': 'Asia/Damascus',
         'past_days': PAST_DAYS, 'forecast_days': FORECAST_DAYS, 'wind_speed_unit': 'ms'}
    url = API + '?' + urllib.parse.urlencode(q)
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'GCSAR-Syria-Irrigation-Platform/0.8'}), timeout=120) as r:
                js = json.loads(r.read().decode('utf8'))
                return js if isinstance(js, list) else [js]
        except Exception as e:
            body = getattr(e, 'read', lambda: b'')()[:300]
            print(f'  ! attempt {k + 1}: {e} {body!r}', flush=True); time.sleep(10 * (k + 1))
    raise RuntimeError('Open-Meteo request failed')


def aggregate(loc):
    """One location's response → {date: {...daily vars}}"""
    h, d = loc['hourly'], loc['daily']
    by_day = {}
    for i, t in enumerate(h['time']):
        day = t[:10]
        g = by_day.setdefault(day, {'rh': [], 'u': []})
        if h['relative_humidity_2m'][i] is not None: g['rh'].append(h['relative_humidity_2m'][i])
        if h['wind_speed_10m'][i] is not None: g['u'].append(h['wind_speed_10m'][i])
    out = {}
    for j, day in enumerate(d['time']):
        g = by_day.get(day, {'rh': [], 'u': []})
        full = len(g['rh']) >= 20 and len(g['u']) >= 20          # require a (nearly) complete local day
        u10 = sum(g['u']) / len(g['u']) if full else None
        out[day] = {
            'tmax': d['temperature_2m_max'][j], 'tmin': d['temperature_2m_min'][j],
            'rhmax': max(g['rh']) if full else None, 'rhmin': min(g['rh']) if full else None,
            'u2': round(wind2m(u10, 10.0), 3) if u10 is not None else None,
            'rs': d['shortwave_radiation_sum'][j], 'rain': d['precipitation_sum'][j],
            'rainProb': d['precipitation_probability_max'][j], 'et0om': d['et0_fao_evapotranspiration'][j]}
    return out


def build(cells, responses):
    per = [aggregate(loc) for loc in responses]
    dates = sorted(set().union(*per))
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=3))).date().isoformat()   # Asia/Damascus (UTC+3, no DST)
    keys = ['tmax', 'tmin', 'rhmax', 'rhmin', 'u2', 'rs', 'rain', 'rainProb', 'et0', 'et0om']
    vars_ = {k: [] for k in keys}
    diffs = []
    for c, series in zip(cells, per):
        rows = {k: [] for k in keys}
        for day in dates:
            v = series.get(day, {})
            doy = dt.date.fromisoformat(day).timetuple().tm_yday
            et, _ = et0_daily(tmin=v.get('tmin'), tmax=v.get('tmax'), u=v.get('u2'), rs=v.get('rs'),
                              elev=c[2] if c[2] is not None else 0, lat=c[0], doy=doy, rhmin=v.get('rhmin'), rhmax=v.get('rhmax'))
            v = {**v, 'et0': None if et is None else round(et, 2)}
            if et is not None and v.get('et0om') is not None and c[3]:
                diffs.append(et - v['et0om'])
            for k in keys:
                x = v.get(k)
                rows[k].append(None if x is None else round(x, 2) if isinstance(x, float) else x)
        for k in keys:
            vars_[k].append(rows[k])
    if diffs:
        mb = sum(diffs) / len(diffs); mae = sum(abs(x) for x in diffs) / len(diffs)
        print(f'ET0 check vs Open-Meteo et0_fao_evapotranspiration (Syrian cells): bias {mb:+.2f}, MAE {mae:.2f} mm/day, n={len(diffs)}')
    return {'issued': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
            'source': 'Open-Meteo forecast API (best_match), timezone Asia/Damascus',
            'firstForecastDate': today, 'pastDays': PAST_DAYS,
            'cell_fields': ['lat', 'lon', 'elev_m', 'gov'], 'cells': cells, 'dates': dates,
            'units': {'tmax': '°C', 'tmin': '°C', 'rhmax': '%', 'rhmin': '%', 'u2': 'm/s (2 m, FAO-56 Eq. 47)',
                      'rs': 'MJ/m2/day', 'rain': 'mm/day', 'rainProb': '% (max of the day)',
                      'et0': 'mm/day (FAO-56 PM, RHmin/RHmax path, this platform)', 'et0om': 'mm/day (Open-Meteo)'},
            'vars': vars_}


def governorate_summary(fc):
    """Per-governorate ET0 for the map: last complete NASA day, previous 7 days (ending yesterday), next 7 days.
    Previous week: NASA POWER where the day is complete, else the Open-Meteo recent-analysis value for that cell/day
    (NASA radiation lags several days) — the share of model days is reported. Next week: forecast from today.
    Governorate value = mean of cells whose centre lies inside it; governorates smaller than a cell take the cell
    nearest to their centroid (same rule as the NASA map)."""
    from nasa_power_sync import load_governorates
    latest = json.load(open(os.path.join(NASA, 'latest.json')))
    today = dt.date.fromisoformat(fc['firstForecastDate'])
    past = [(today - dt.timedelta(days=k)).isoformat() for k in range(7, 0, -1)]
    nxt = [(today + dt.timedelta(days=k)).isoformat() for k in range(0, 7)]
    fpos = {d: j for j, d in enumerate(fc['dates'])}
    arch = {}
    for y in {int(d[:4]) for d in past}:
        path = os.path.join(NASA, f'{y}.json')
        if os.path.exists(path):
            a = json.load(open(path)); arch[y] = (a, {d: j for j, d in enumerate(a['dates'])})
    cells = fc['cells']
    def cell_val(i, day, prefer_nasa):
        if prefer_nasa and int(day[:4]) in arch:
            a, pos = arch[int(day[:4])]; j = pos.get(day.replace('-', ''))
            if j is not None and a['vars']['ET0'][i][j] is not None:
                return a['vars']['ET0'][i][j], 'nasa'
        j = fpos.get(day)
        return (fc['vars']['et0'][i][j], 'model') if j is not None and fc['vars']['et0'][i][j] is not None else (None, None)
    members = {}
    for i, c in enumerate(cells):
        if c[3]: members.setdefault(c[3], []).append(i)
    for key, polys in load_governorates():
        if key not in members:
            ring = max((poly[0] for poly in polys), key=len)
            cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
            members[key] = [min(range(len(cells)), key=lambda i: (cells[i][0] - cy) ** 2 + ((cells[i][1] - cx) * 0.82) ** 2)]
    out = {}
    for key, idx in members.items():
        def period(days, prefer_nasa):
            daily, model = [], 0
            for day in days:
                vals = []
                for i in idx:
                    v, src = cell_val(i, day, prefer_nasa)
                    if v is not None: vals.append(v); model += src == 'model'
                if vals: daily.append(sum(vals) / len(vals))
            if len(daily) < len(days) - 1: return None          # allow one missing day at most
            n = len(idx) * len(days)
            return {'mean': round(sum(daily) / len(daily), 2), 'sum': round(sum(daily) * len(days) / len(daily), 1),
                    'modelShare': round(model / n, 2) if prefer_nasa else 1.0}
        g = latest['governorates'].get(key)
        out[key] = {'day': {'mean': g['et0'], 'method': g.get('method')} if g else None,
                    'past7': period(past, True), 'next7': period(nxt, False)}
    return {'issued': fc['issued'], 'nasaDay': latest['date'], 'past7': [past[0], past[-1]], 'next7': [nxt[0], nxt[-1]],
            'governorates': out}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--from-file'); a = ap.parse_args()
    cells = grid_cells()
    if a.from_file:
        responses = json.load(open(a.from_file))
    else:
        responses = []
        for i in range(0, len(cells), CHUNK):
            print(f'GET cells {i}..{min(i + CHUNK, len(cells)) - 1}', flush=True)
            responses += fetch(cells[i:i + CHUNK]); time.sleep(1)
    if len(responses) != len(cells):
        raise RuntimeError(f'expected {len(cells)} locations, got {len(responses)}')
    out = build(cells, responses)
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, 'latest.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    summ = governorate_summary(out)
    json.dump(summ, open(os.path.join(OUT, 'map.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('map summary (Hama):', summ['governorates'].get('hama'))
    print(f"wrote forecast: {len(cells)} cells × {len(out['dates'])} days ({out['dates'][0]} → {out['dates'][-1]}), forecast from {out['firstForecastDate']}")


if __name__ == '__main__':
    main()
