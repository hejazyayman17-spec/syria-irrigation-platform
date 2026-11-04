"""Open-Meteo evaluation, step 1 (runs on GitHub Actions): fetch the Open-Meteo series the platform would have used,
at the NASA cell centres of the reference stations, for the period those stations have recent daily records.

Why: the last days before "today" (NASA latency) come from Open-Meteo's recent analysis ('model' days) and the next 7 days
from its forecast. Both enter the water balance uncorrected. This fetch provides
  hist   — Historical Forecast API (best_match): the stitched short-range series, a proxy for the 'model' days
  lead   — Previous Runs API (best_match): the same variables as forecast 1, 3, 5 and 7 days ahead
Variables and daily aggregation are those of tools/forecast_sync.py (Tmax/Tmin daily; RHmax/RHmin and mean wind from hourly;
Rs daily sum; rain). Only Open-Meteo data is written here; the station data stay in the private research repository and
the comparison is run there (step 2).
Output: tools/om_eval/out/om.json   Usage: python tools/om_eval/fetch.py
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'out'); os.makedirs(OUT, exist_ok=True)
# NASA cell centre (lat, lon) of each reference station, and the period with recent ground records
SITES = {
    'Nashabiyah': (33.5, 36.25, '2024-01-01', '2026-09-30'),
    'Gaziantep_TR': (37.0, 37.5, '2024-01-01', '2025-08-24'),
    'Kilis_TR': (36.5, 36.875, '2024-01-01', '2025-08-24'),
    'Mafraq_JO': (32.5, 36.25, '2024-01-01', '2025-08-24'),
    'Aleppo': (36.0, 37.5, '2024-01-01', '2025-08-24'),
    'Irbid_JO': (32.5, 35.625, '2024-01-01', '2025-08-24'),
    'Prince_Hasan_JO': (32.0, 36.875, '2024-01-01', '2025-08-24'),
    'Sanliurfa_TR': (37.0, 38.75, '2024-01-01', '2025-08-24'),
    'Qamishli': (37.0, 41.25, '2024-01-01', '2024-12-07'),
    'Hama': (35.0, 36.875, '2024-01-01', '2024-11-29'),
    'Rutbah_IQ': (33.0, 40.0, '2024-01-01', '2025-08-10'),
}
UA = {'User-Agent': 'GCSAR-Syria-Irrigation-Platform/eval'}
HIST = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
PREV = 'https://previous-runs-api.open-meteo.com/v1/forecast'
LEADS = [1, 3, 5, 7]
BASE_H = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'shortwave_radiation', 'precipitation']


def get(url, q, tries=5):
    u = url + '?' + urllib.parse.urlencode(q)
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=180) as r:
                return json.loads(r.read().decode('utf8'))
        except Exception as e:
            body = getattr(e, 'read', lambda: b'')()[:300]
            print(f'  ! {url.split("/")[2]} try {k + 1}: {e} {body!r}', flush=True); time.sleep(15 * (k + 1))
    return None


def daily_from_hourly(h, suffix=''):
    """hourly (local time) → {date: tmax, tmin, rhmax, rhmin, u10, rs (MJ), rain}; day kept only if >= 20 h present"""
    g = {}
    for i, t in enumerate(h['time']):
        d = g.setdefault(t[:10], {k: [] for k in BASE_H})
        for k in BASE_H:
            v = h.get(k + suffix, [None] * len(h['time']))[i]
            if v is not None: d[k].append(v)
    out = {}
    for day, d in g.items():
        if min(len(d[k]) for k in BASE_H) < 20: continue
        out[day] = {'tmax': max(d['temperature_2m']), 'tmin': min(d['temperature_2m']), 'rhmax': max(d['relative_humidity_2m']),
                    'rhmin': min(d['relative_humidity_2m']), 'u10': sum(d['wind_speed_10m']) / len(d['wind_speed_10m']),
                    'rs': sum(d['shortwave_radiation']) * 0.0036, 'rain': sum(d['precipitation'])}
    return out


def main():
    p = os.path.join(OUT, 'om.json')
    res = json.load(open(p)) if os.path.exists(p) else {}
    for site, (lat, lon, a, b) in SITES.items():
        r = res.setdefault(site, {'lat': lat, 'lon': lon})
        if not r.get('hist'):
            q = {'latitude': lat, 'longitude': lon, 'start_date': a, 'end_date': b, 'timezone': 'Asia/Damascus', 'wind_speed_unit': 'ms',
                 'hourly': ','.join(BASE_H), 'daily': 'temperature_2m_max,temperature_2m_min,shortwave_radiation_sum,precipitation_sum,et0_fao_evapotranspiration'}
            js = get(HIST, q)
            if js:
                hd = daily_from_hourly(js['hourly']); d = js['daily']
                for j, day in enumerate(d['time']):        # daily Tmax/Tmin/Rs exactly as forecast_sync.py uses them
                    if day in hd:
                        hd[day].update(tmax=d['temperature_2m_max'][j], tmin=d['temperature_2m_min'][j], rs=d['shortwave_radiation_sum'][j],
                                       rain=d['precipitation_sum'][j], et0om=d['et0_fao_evapotranspiration'][j])
                r['hist'] = hd; r['elev'] = js.get('elevation')
            print(site, 'hist', len(r.get('hist') or {}), flush=True)
        r.setdefault('lead', {})
        for L in LEADS:
            if r['lead'].get(str(L)): continue
            q = {'latitude': lat, 'longitude': lon, 'start_date': a, 'end_date': b, 'timezone': 'Asia/Damascus', 'wind_speed_unit': 'ms',
                 'hourly': ','.join(f'{k}_previous_day{L}' for k in BASE_H)}
            js = get(PREV, q)
            if js: r['lead'][str(L)] = daily_from_hourly(js['hourly'], f'_previous_day{L}')
            print(site, 'lead', L, len(r['lead'].get(str(L)) or {}), flush=True)
        json.dump(res, open(p, 'w'), separators=(',', ':'))
    print('wrote', p)


if __name__ == '__main__':
    main()
