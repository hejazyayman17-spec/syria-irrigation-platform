/* Engine test runner (Node, no dependencies):  node tests/run_engine_tests.js
 * The same JSON vectors in tests/vectors/ are the acceptance tests for the future C# engine (xUnit). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
for (const f of ['fao56', 'crops', 'soils', 'waterbalance', 'correction']) vm.runInThisContext(fs.readFileSync(path.join(root, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
const { Fao56, WaterBalance, Crops } = globalThis.GCSAR;
let fail = 0;
const near = (name, got, exp, tol) => { const ok = Math.abs(got - exp) <= tol; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got} (expected ${exp} ± ${tol})`); };

for (const file of fs.readdirSync(path.join(__dirname, 'vectors')).sort()) {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', file), 'utf8'));
  if (v.type === 'et0') {
    const r = Fao56.et0FromRecord(v.record, v.meta, new Date(v.date + 'T00:00:00'));
    for (const [k, [exp, tol]] of Object.entries(v.expect)) near(`${v.name} ${k}`, +r[k].toFixed(4), exp, tol);
  } else if (v.type === 'function') {
    const fn = v.fn.split('.').reduce((o, k) => o[k], globalThis.GCSAR);
    near(v.name, +fn(...v.args).toFixed(4), v.expect[0], v.expect[1]);
  } else if (v.type === 'correction-parity') {
    const eng = globalThis.GCSAR.Correction.engine(JSON.parse(fs.readFileSync(path.join(root, v.model), 'utf8')));
    const cases = JSON.parse(fs.readFileSync(path.join(root, v.cases), 'utf8'));
    let worst = 0, bad = 0;
    for (const c of cases) {
      const s = c.site, d = c.day, e = c.expected;
      const site = { lat: s.lat, lon: s.lon, elevationM: s.elev, siteType: s.site_type, measuredWindFactor: s.measured };
      const res = eng.resolve(site), r = eng.correct(site, { date: d.date, tmax: d.tmax, tmin: d.tmin, tdew: d.tdew, rs: d.rs, ws2m: d.ws2m }, res);
      for (const [k, x] of [['tmax', r.tmax], ['tmin', r.tmin], ['tdew', r.tdew], ['rs', r.rs], ['u2', r.u2], ['et0_raw', r.et0Raw], ['et0', r.et0], ['unc', r.unc]]) {
        const diff = Math.abs(x - e[k]); worst = Math.max(worst, diff);
        if (diff > Math.max(v.tolerance, v.tolerance * Math.abs(e[k]))) { bad++; console.log(`  ${s.name} ${d.date} ${k}: JS ${x} expected ${e[k]}`); }
      }
      if (r.level !== e.level || res.windSource !== e.wind_source || res.warnings.length !== e.n_warnings) { bad++; console.log(`  ${s.name} ${d.date}: level ${r.level}/${e.level} wind ${res.windSource}/${e.wind_source} warnings ${res.warnings.length}/${e.n_warnings}`); }
    }
    if (bad) fail++;
    console.log(`${bad ? 'FAIL' : 'PASS'}  ${v.name}: ${cases.length} cases, largest difference ${worst.toExponential(2)}`);
  } else if (v.type === 'season') {
    const input = { ...v.input, crop: { ...Crops.get(v.input.cropKey), ...(v.input.cropOverride || {}) }, weather: expandWeather(v.input.weatherGen) };
    const out = WaterBalance.run(input);
    const lastDay = out.days[out.days.length - 1];
    const derived = { MaxSingleNetMm: Math.max(...out.days.map(d => d.Inet)), ForecastRainCountedMm: out.forecast.P,
      LastDayIsMaturity: lastDay.Date === v.input.maturityDate ? 1 : 0, LastStage: lastDay.Stage, SeasonDays: out.days.length, KcMidUsed: out.kcMidAdj };
    for (const [k, [exp, tol]] of Object.entries(v.expect)) near(`${v.name} ${k}`, k in derived ? derived[k] : out.summary[k], exp, tol);
  }
}
/* deterministic synthetic weather: constant or sinusoidal season */
function expandWeather(g) {
  const out = []; const d0 = new Date(g.start + 'T00:00:00Z');   // UTC: the same dates on every machine/time zone
  for (let i = 0; i < g.days; i++) {
    const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i);
    const ph = Math.sin(2 * Math.PI * i / g.days);
    out.push({ date: d.toISOString().slice(0, 10), tmin: g.tmin + g.amp * ph, tmax: g.tmax + g.amp * ph, et0: g.et0 + g.et0amp * ph,
      rain: (i % g.rainEvery === 0) ? g.rainMm : 0, u2: g.u2, rhmin: g.rhmin,
      ...(g.forecastLastDays && i >= g.days - g.forecastLastDays ? { kind: 'forecast', rainProb: g.rainProb } : {}) });
  }
  return out;
}
console.log(fail ? `\n${fail} test(s) FAILED` : '\nAll engine tests passed');
process.exit(fail ? 1 : 0);
