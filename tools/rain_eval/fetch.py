"""Fetch candidate rain products at the reference stations (runs on GitHub Actions — needs internet).
  NASA POWER  PRECTOTCORR  daily  (point API, community AG)
  ERA5-Land   precipitation_sum daily (Open-Meteo historical archive, models=era5_land)
  CHIRPS      monthly totals at the station pixel: v3.0 when the file exists, else v2.0 (0.05°)
Output: tools/rain_eval/out/products.json  {station_id: {nasa:{date:mm}, era5land:{date:mm}, chirps:{YYYY-MM:mm}, chirps_version:{YYYY-MM:'v3'|'v2'}}}
Usage: python tools/rain_eval/fetch.py"""
import gzip, io, json, os, sys, time, urllib.request, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'stations.json'), encoding='utf-8'))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'GCSAR-irrigation-platform rain evaluation'}


def get(url, tries=4, timeout=180):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1:
                raise
            print('  retry', k + 1, url[:90], e); time.sleep(10 * (k + 1))


def nasa(st):
    s, e = CFG['start'].replace('-', ''), CFG['end'].replace('-', '')
    url = (f'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG'
           f'&longitude={st["lon"]}&latitude={st["lat"]}&start={s}&end={e}&format=JSON&time-standard=LST')
    d = json.loads(get(url))['properties']['parameter']['PRECTOTCORR']
    return {f'{k[:4]}-{k[4:6]}-{k[6:]}': v for k, v in d.items() if v is not None and v > -900}


def era5land(st):
    """ERA5-Land daily totals from Open-Meteo, requested in 5-year chunks; falls back to the hourly series summed per local day."""
    end = min(dt.date.fromisoformat(CFG['end']), dt.date.today() - dt.timedelta(days=7))
    out, y = {}, int(CFG['start'][:4])
    while dt.date(y, 1, 1) <= end:
        a, b = f'{y}-01-01', min(dt.date(y + 4, 12, 31), end).isoformat()
        base = f'https://archive-api.open-meteo.com/v1/archive?latitude={st["lat"]}&longitude={st["lon"]}&start_date={a}&end_date={b}&models=era5_land&timezone=auto'
        j = json.loads(get(base + '&daily=precipitation_sum', timeout=300))
        got = {d: v for d, v in zip(j.get('daily', {}).get('time', []), j.get('daily', {}).get('precipitation_sum', [])) if v is not None}
        if not got:
            j = json.loads(get(base + '&hourly=precipitation', timeout=300)); acc = {}
            for t, v in zip(j['hourly']['time'], j['hourly']['precipitation']):
                if v is not None: acc[t[:10]] = acc.get(t[:10], 0.0) + v
            got = {d: round(v, 2) for d, v in acc.items()}
            print('  ERA5-Land hourly fallback', a, len(got))
        print('  ERA5-Land', a, b, len(got), flush=True)
        out.update(got); y += 5; time.sleep(3)
    return out


def chirps_points(y, m, pts):
    """Monthly CHIRPS at the station pixels — v3 first, then v2. Point reads over HTTP range requests (/vsicurl),
    so only the needed strips are fetched; a bad file is retried, then the other version is tried."""
    import rasterio
    srcs = (('v3', f'/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.{y}.{m:02d}.tif'),
            ('v2', f'/vsigzip//vsicurl/https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_monthly/tifs/chirps-v2.0.{y}.{m:02d}.tif.gz'))
    for ver, path in srcs:
        for k in range(3):
            try:
                with rasterio.Env(GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='5', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.gz'):
                    with rasterio.open(path) as ds:
                        vals = [float(v[0]) for v in ds.sample(pts)]
                return vals, ver
            except Exception as e:
                print('  CHIRPS', ver, y, m, 'try', k + 1, str(e)[:120]); time.sleep(5 * (k + 1))
    return None, None


def main():
    only = os.environ.get('ONLY', '')
    res = {s['id']: {'nasa': {}, 'era5land': {}, 'chirps': {}, 'chirps_version': {}} for s in CFG['stations']}
    fp = os.path.join(OUT, 'products.json')
    if only and os.path.exists(fp): res.update(json.load(open(fp)))
    for st in CFG['stations']:
        print('station', st['id'])
        if not only:
            try: res[st['id']]['nasa'] = nasa(st)
            except Exception as e: print('  NASA failed', e)
        try: res[st['id']]['era5land'] = era5land(st)
        except Exception as e: print('  ERA5-Land failed', repr(e)[:200])
        time.sleep(1)
    json.dump(res, open(os.path.join(OUT, 'products.json'), 'w'), separators=(',', ':'))  # keep NASA/ERA5 even if CHIRPS fails
    if only: print('wrote products.json (ERA5-Land only)'); return
    pts = [(st['lon'], st['lat']) for st in CFG['stations']]
    y0, y1 = int(CFG['start'][:4]), int(CFG['end'][:4])
    last = dt.date.today()
    for y in range(y0, y1 + 1):
        for m in range(1, 13):
            if dt.date(y, m, 1) > last:
                break
            vals, ver = chirps_points(y, m, pts)
            if vals is None:
                print('  CHIRPS missing', y, m); continue
            for st, v in zip(CFG['stations'], vals):
                if v >= 0:
                    res[st['id']]['chirps'][f'{y}-{m:02d}'] = round(v, 2)
                    res[st['id']]['chirps_version'][f'{y}-{m:02d}'] = ver
        print('  CHIRPS year', y, 'done', flush=True)
        json.dump(res, open(os.path.join(OUT, 'products.json'), 'w'), separators=(',', ':'))
    json.dump(res, open(os.path.join(OUT, 'products.json'), 'w'), separators=(',', ':'))
    print('wrote products.json')


if __name__ == '__main__':
    main()
