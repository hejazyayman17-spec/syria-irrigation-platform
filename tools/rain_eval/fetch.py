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
    end = min(dt.date.fromisoformat(CFG['end']), dt.date.today() - dt.timedelta(days=7)).isoformat()
    url = (f'https://archive-api.open-meteo.com/v1/archive?latitude={st["lat"]}&longitude={st["lon"]}'
           f'&start_date={CFG["start"]}&end_date={end}&daily=precipitation_sum&models=era5_land&timezone=auto')
    j = json.loads(get(url))
    return {d: v for d, v in zip(j['daily']['time'], j['daily']['precipitation_sum']) if v is not None}


def chirps_month(y, m):
    """(array reader, version) for one month — v3 first, then v2."""
    import rasterio
    from rasterio.io import MemoryFile
    for ver, url, gz in (('v3', f'https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/chirps-v3.0.{y}.{m:02d}.tif', False),
                         ('v2', f'https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_monthly/tifs/chirps-v2.0.{y}.{m:02d}.tif.gz', True)):
        try:
            raw = get(url, tries=2)
        except Exception:
            continue
        if gz:
            raw = gzip.decompress(raw)
        mf = MemoryFile(raw)
        return mf.open(), ver
    return None, None


def main():
    res = {s['id']: {'nasa': {}, 'era5land': {}, 'chirps': {}, 'chirps_version': {}} for s in CFG['stations']}
    for st in CFG['stations']:
        print('station', st['id'])
        try: res[st['id']]['nasa'] = nasa(st)
        except Exception as e: print('  NASA failed', e)
        try: res[st['id']]['era5land'] = era5land(st)
        except Exception as e: print('  ERA5-Land failed', e)
        time.sleep(1)
    y0, y1 = int(CFG['start'][:4]), int(CFG['end'][:4])
    last = dt.date.today()
    for y in range(y0, y1 + 1):
        for m in range(1, 13):
            if dt.date(y, m, 1) > last:
                break
            ds, ver = chirps_month(y, m)
            if ds is None:
                print('  CHIRPS missing', y, m); continue
            band = ds.read(1)
            for st in CFG['stations']:
                r, c = ds.index(st['lon'], st['lat'])
                v = float(band[r, c])
                if v >= 0:
                    res[st['id']]['chirps'][f'{y}-{m:02d}'] = round(v, 2)
                    res[st['id']]['chirps_version'][f'{y}-{m:02d}'] = ver
            ds.close()
        print('  CHIRPS year', y, 'done')
    json.dump(res, open(os.path.join(OUT, 'products.json'), 'w'), separators=(',', ':'))
    print('wrote products.json')


if __name__ == '__main__':
    main()
