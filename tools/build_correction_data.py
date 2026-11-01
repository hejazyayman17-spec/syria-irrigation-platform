"""Build the platform's climate-correction data from the research repository (nashabiyah-nasa-power).

Writes data/correction/:
  correction_coefficients.json  — copied unchanged from dotnet/GCSAR.ClimateCorrection/Data (the C# library's file)
  validation_stats.json         — agreement statistics of each reference station, NASA raw vs corrected
                                  (n, MBE, MAE, RMSE, nRMSE %, Willmott d, NSE, KGE, r, bias %), keyed by NASA cell id
  correction_data.js            — both files as one script (works from file:// and offline; loaded by index.html)
Usage: python tools/build_correction_data.py ../nashabiyah-nasa-power
Standard library only. Re-run whenever the research repository updates its coefficients or validation."""
import csv, json, math, os, shutil, sys

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join('..', 'nashabiyah-nasa-power'))
R = os.path.join(SRC, 'results')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'correction')
METRICS = [('n', 'n'), ('mean_obs', 'mean_obs'), ('mean_sim', 'mean_sim'), ('r', 'r'), ('MBE', 'MBE'), ('MAE', 'MAE'),
           ('RMSE', 'RMSE'), ('nRMSE_%', 'nRMSE'), ('d_Willmott', 'd'), ('NSE', 'NSE'), ('KGE', 'KGE'), ('bias_%', 'bias_pct')]


def cell(lat, lon):
    return f'{round(0.5 * math.floor(lat / 0.5 + 0.5), 4)}_{round(0.625 * math.floor(lon / 0.625 + 0.5), 4)}'


def rows(path):
    with open(os.path.join(R, path), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        x = float(v)
        return None if math.isnan(x) else round(x, 4)
    except (TypeError, ValueError):
        return None


def pick(r):
    return {k2: num(r.get(k1)) for k1, k2 in METRICS if r.get(k1) not in (None, '')}


VAR = {'tmax': 'tmax', 'Tmax': 'tmax', 'tmin': 'tmin', 'Tmin': 'tmin', 'tdew': 'tdew', 'Tdew': 'tdew', 'rs': 'rs', 'Rs': 'rs', 'u2': 'u2', 'ET0': 'et0'}
stats = {}


def put(cid, station, var, raw, corr, method):
    e = stats.setdefault(cid, {'station': station, 'variables': {}})
    e['variables'][var] = {'raw': raw, 'corrected': corr, 'method': method}


# 1) Al-Nashabiyah (Ghouta cell): full daily statistics for every variable and ET0
hv = {r['']: r for r in rows('harmonic_validation.csv')}
cid = cell(33.5097, 36.4831)
for v, corr_key in (('Tmax', 'DOY equation'), ('Tmin', 'DOY equation'), ('Tdew', 'DOY equation'), ('Rs', 'DOY equation'),
                    ('u2', 'DOY equation (LOYO)'), ('ET0', 'PM from DOY-corrected inputs')):
    put(cid, 'Al-Nashabiyah', VAR[v], pick(hv[f'{v} | NASA raw']), pick(hv[f'{v} | {corr_key}']),
        'كل المدخلات مصححة ومنها الرياح، ثم إعادة حساب ET₀' if v == 'ET0' else 'معادلة يوم السنة')

# 2) Met-directorate stations (Homs, Quneitra, Latakia, Tartous): variables, leave-one-year-out
MET = {'Quneitra': (33.125, 35.8222), 'Homs': (34.7292, 36.725), 'Latakia': (35.5236, 35.7792), 'Tartous': (34.8711, 35.8825)}
for r in rows('phase2/validation.csv'):
    if r['station'] in MET and r['level'] in ('NASA raw', 'DOY equation (LOYO)'):
        cid = cell(*MET[r['station']]); var = VAR[r['variable']]
        e = stats.setdefault(cid, {'station': r['station'], 'variables': {}}).setdefault('variables', {})
        slot = e.setdefault(var, {'method': 'معادلة يوم السنة (تحقق بترك سنة خارجاً)'})
        slot['raw' if r['level'] == 'NASA raw' else 'corrected'] = pick(r)
for r in rows('phase2/et0_effects_monthly.csv'):
    if r['station'] in MET and r['month'] == 'year':
        put(cell(*MET[r['station']]), r['station'], 'et0',
            {'n': num(r['n']), 'mean_obs': num(r['et0_ground']), 'bias_pct': num(r['bias%_nasa']), 'RMSE': num(r['rmse_nasa'])},
            {'n': num(r['n']), 'mean_obs': num(r['et0_ground']), 'bias_pct': num(r['bias%_doy_corr']), 'RMSE': num(r['rmse_doy'])},
            'أثر تصحيح الحرارة والرطوبة والإشعاع (رياح ناسا نفسها في الطرفين)؛ خطأ الرياح في الهامش')

# 3) GSOD stations (Badia, Euphrates, Khabur, Yarmouk)
GS = {'Palmyra': (34.557, 38.317, False), 'Deir ez-Zor': (35.285, 40.176, False), 'Abu Kamal': (34.417, 40.917, False),
      'Raqqa': (35.933, 39.017, False), 'Hasakah': (36.5, 40.75, False), 'Qamishli': (37.021, 41.191, False),
      'Aleppo': (36.181, 37.224, False), 'Mafraq (JO)': (32.356, 36.259, True), 'Irbid (JO)': (32.55, 35.85, False)}
for r in rows('phase2_gsod/validation.csv'):
    if r['station'] in GS and r['level'] in ('NASA raw', 'DOY equation (LOYO)'):
        lat, lon, wind_ok = GS[r['station']]
        var = VAR[r['variable']]
        if var == 'u2' and not wind_ok:
            continue                       # the platform does not use this station's wind equation
        e = stats.setdefault(cell(lat, lon), {'station': r['station'], 'variables': {}})['variables']
        slot = e.setdefault(var, {'method': 'معادلة يوم السنة (تحقق بترك سنة خارجاً)'})
        slot['raw' if r['level'] == 'NASA raw' else 'corrected'] = pick(r)
for r in rows('phase2_gsod/et0_monthly.csv'):
    if r['station'] in GS and r['month'] == 'year':
        lat, lon, wind_ok = GS[r['station']]
        if wind_ok:
            raw = {'n': num(r['n']), 'mean_obs': num(r['et0_ground']), 'bias_pct': num(r['bias%_nasa']), 'RMSE': num(r['rmse_nasa'])}
            cor = {'n': num(r['n']), 'mean_obs': num(r['et0_ground']), 'bias_pct': num(r['bias%_corr_all']), 'RMSE': num(r['rmse_corr_all'])}
            how = 'كل المدخلات مصححة، ومنها الرياح بمعادلة الخلية'
        else:
            raw = {'n': num(r['n']), 'mean_obs': num(r['et0_ground_TRH']), 'bias_pct': num(r['TRH_bias%_nasa']), 'RMSE': num(r['TRH_rmse_nasa'])}
            cor = {'n': num(r['n']), 'mean_obs': num(r['et0_ground_TRH']), 'bias_pct': num(r['TRH_bias%_corr']), 'RMSE': num(r['TRH_rmse_corr'])}
            how = 'أثر الحرارة والرطوبة (بالرياح المقاسة)؛ خطأ معامل الرياح الافتراضي يُضاف في الهامش'
        put(cell(lat, lon), r['station'], 'et0', raw, cor, how)
        stats[cell(lat, lon)]['et0_nasa_full_raw'] = {'bias_pct': num(r['bias%_nasa']), 'RMSE': num(r['rmse_nasa'])}

# 4) Hama cell (GSOD Hama; Tizin agrees)
for r in rows('phase2_hama/et0.csv'):
    if r['station'] == 'Hama' and r['case'] in ('NASA raw', 'equation from Hama'):
        e = stats.setdefault(cell(35.117, 36.75), {'station': 'Hama', 'variables': {}})['variables']
        slot = e.setdefault('et0', {'method': 'أثر تصحيح الحرارة والرطوبة (رياح ناسا نفسها في الطرفين)؛ خطأ الرياح في الهامش'})
        slot['raw' if r['case'] == 'NASA raw' else 'corrected'] = {'n': num(r['n']), 'mean_obs': num(r['et0_ground']), 'bias_pct': num(r['bias%']), 'RMSE': num(r['rmse'])}

os.makedirs(OUT, exist_ok=True)
coef_src = os.path.join(SRC, 'dotnet', 'GCSAR.ClimateCorrection', 'Data', 'correction_coefficients.json')
shutil.copyfile(coef_src, os.path.join(OUT, 'correction_coefficients.json'))
coef = json.load(open(coef_src, encoding='utf-8'))
val = {'source': 'nashabiyah-nasa-power/results', 'metrics_ar': {
    'MBE': 'الانحياز (متوسط الفرق)', 'MAE': 'متوسط الخطأ المطلق', 'RMSE': 'جذر متوسط مربع الخطأ', 'nRMSE': 'RMSE نسبةً إلى المتوسط %',
    'd': 'مؤشر التوافق (Willmott d)', 'NSE': 'كفاءة Nash–Sutcliffe', 'KGE': 'كفاءة Kling–Gupta', 'r': 'معامل الارتباط', 'bias_pct': 'الانحياز %'},
    'cells': stats}
json.dump(val, open(os.path.join(OUT, 'validation_stats.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
with open(os.path.join(OUT, 'correction_data.js'), 'w', encoding='utf-8') as f:
    f.write('// Generated by tools/build_correction_data.py — do not edit by hand\n')
    f.write('const GCSAR_CORRECTION_MODEL=' + json.dumps(coef, ensure_ascii=False, separators=(',', ':')) + ';\n')
    f.write('const GCSAR_CORRECTION_VALIDATION=' + json.dumps(val, ensure_ascii=False, separators=(',', ':')) + ';\n')
shutil.copyfile(os.path.join(SRC, 'dotnet', 'GCSAR.ClimateCorrection.Tests', 'parity_cases.json'),
                os.path.join(os.path.dirname(os.path.dirname(OUT)), 'tests', 'correction_parity_cases.json'))
missing = [c['id'] for c in coef['cells'] if c['id'] not in stats]
print('cells with validation:', len(stats), '| coefficient cells without stats:', missing)
