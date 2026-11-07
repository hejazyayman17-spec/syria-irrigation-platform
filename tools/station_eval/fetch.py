"""NASA POWER daily inputs and CHIRPS monthly rain at the GCSAR research stations, 2002–2012 (runs on GitHub Actions).
The station records are private; only these public products are written here. Comparison runs in the research repository.
Output: tools/station_eval/out/products.json  {id: {nasa: {YYYY-MM-DD: {tmax,tmin,tdew,rs,u2,rain,ps}}, chirps: {YYYY-MM: mm}}}"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'rain_eval'))
from fetch import get, chirps_points          # same retry and CHIRPS point-read logic as the rain evaluation

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'stations.json'), encoding='utf-8'))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
PAR = {'T2M_MAX': 'tmax', 'T2M_MIN': 'tmin', 'T2MDEW': 'tdew', 'ALLSKY_SFC_SW_DWN': 'rs', 'WS2M': 'u2', 'PRECTOTCORR': 'rain', 'PS': 'ps'}


def nasa(st):
    s, e = CFG['start'].replace('-', ''), CFG['end'].replace('-', '')
    url = (f'https://power.larc.nasa.gov/api/temporal/daily/point?parameters={",".join(PAR)}&community=AG'
           f'&longitude={st["lon"]}&latitude={st["lat"]}&start={s}&end={e}&format=JSON&time-standard=LST')
    p = json.loads(get(url, timeout=300))['properties']['parameter']; out = {}
    for k in p['PRECTOTCORR']:
        out[f'{k[:4]}-{k[4:6]}-{k[6:]}'] = {v: (p[n][k] if p[n][k] is not None and p[n][k] > -900 else None) for n, v in PAR.items()}
    return out


def main():
    path = os.path.join(OUT, 'products.json')
    res = json.load(open(path)) if os.path.exists(path) else {}
    sts = CFG['stations']
    for st in sts:
        r = res.setdefault(st['id'], {})
        if not r.get('nasa'):
            r['nasa'] = nasa(st); print(st['id'], 'NASA', len(r['nasa']), flush=True); time.sleep(2)
        json.dump(res, open(path, 'w'), separators=(',', ':'))
    pts = [(s['lon'], s['lat']) for s in sts]
    for y in range(int(CFG['start'][:4]), int(CFG['end'][:4]) + 1):
        for m in range(1, 13):
            k = f'{y}-{m:02d}'
            if all(k in res[s['id']].get('chirps', {}) for s in sts): continue
            vals, ver = chirps_points(y, m, pts)
            if vals is None: print('  CHIRPS missing', k); continue
            for s, v in zip(sts, vals): res[s['id']].setdefault('chirps', {})[k] = round(v, 1) if v >= 0 else None
        print('CHIRPS', y, flush=True); json.dump(res, open(path, 'w'), separators=(',', ':'))
    print('wrote', path)


if __name__ == '__main__':
    main()
