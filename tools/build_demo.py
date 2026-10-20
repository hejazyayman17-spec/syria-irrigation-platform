"""Build the committee demo (demo/index.html): one self-contained page.
The page embeds the platform's own engine files (js/engine/*.js, unchanged) and one real season of
NASA POWER daily weather for the Salamiyah grid cell, so every number on the demo dashboard is computed
live in the browser by the same engine as the platform. Only the field itself is fictional.
Usage: python tools/build_demo.py   → demo/index.html (standalone) + demo/demo-fragment.html (artifact body)"""
import json, math, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT, LON = 35.01, 37.05
START, END = '20251101', '20260630'
NM = {'T2M_MAX': 'Tmax_C', 'T2M_MIN': 'Tmin_C', 'T2MDEW': 'DewPoint_C', 'RH2M': 'RHmean_pct',
      'WS2M': 'WindSpeed_m_s', 'ALLSKY_SFC_SW_DWN': 'SolarRadiation_MJ_m2_day', 'PRECTOTCORR': 'Rain_mm'}

def nearest(cells, lat, lon):
    k = math.cos(math.radians(lat))
    return min(range(len(cells)), key=lambda i: (cells[i][0] - lat) ** 2 + ((cells[i][1] - lon) * k) ** 2)

def weather():
    rows, cell = [], None
    for y in (START[:4], END[:4]):
        a = json.load(open(os.path.join(ROOT, 'data', 'nasa', f'{y}.json')))
        ci = nearest(a['cells'], LAT, LON); cell = a['cells'][ci]
        for j, d in enumerate(a['dates']):
            if START <= d <= END:
                r = [d] + [a['vars'][p][ci][j] for p in NM]
                rows.append(r)
    return {'cell': cell[:3], 'cols': ['date'] + list(NM.values()), 'rows': rows}

def main():
    rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
    eng = '\n'.join(rd('js', 'engine', f) for f in ('fao56.js', 'crops.js', 'soils.js', 'waterbalance.js'))
    gov = rd('data', 'syria_gov.js')
    tpl = rd('demo', 'template.html')
    W = weather()
    frag = (tpl.replace('/*@@ENGINE@@*/', eng)
               .replace('/*@@MAP@@*/', gov)
               .replace('/*@@WEATHER@@*/', 'const DEMO_WX=' + json.dumps(W, separators=(',', ':')) + ';'))
    open(os.path.join(ROOT, 'demo', 'demo-fragment.html'), 'w', encoding='utf-8').write(frag)
    full = '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + frag + '\n</body>\n</html>\n'
    open(os.path.join(ROOT, 'demo', 'index.html'), 'w', encoding='utf-8').write(full)
    print('demo built:', len(W['rows']), 'days, cell', W['cell'], f'{len(full)/1024:.0f} KB')

if __name__ == '__main__':
    main()
