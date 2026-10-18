/* Engine test runner (Node, no dependencies):  node tests/run_engine_tests.js
 * The same JSON vectors in tests/vectors/ are the acceptance tests for the future C# engine (xUnit). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
for (const f of ['fao56', 'crops', 'soils', 'waterbalance']) vm.runInThisContext(fs.readFileSync(path.join(root, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
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
  } else if (v.type === 'season') {
    const input = { ...v.input, crop: { ...Crops.get(v.input.cropKey), ...(v.input.cropOverride || {}) }, weather: expandWeather(v.input.weatherGen) };
    const out = WaterBalance.run(input);
    const derived = { MaxSingleNetMm: Math.max(...out.days.map(d => d.Inet)), ForecastRainCountedMm: out.forecast.P };
    for (const [k, [exp, tol]] of Object.entries(v.expect)) near(`${v.name} ${k}`, k in derived ? derived[k] : out.summary[k], exp, tol);
  }
}
/* deterministic synthetic weather: constant or sinusoidal season */
function expandWeather(g) {
  const out = []; const d0 = new Date(g.start + 'T00:00:00');
  for (let i = 0; i < g.days; i++) {
    const d = new Date(d0); d.setDate(d.getDate() + i);
    const ph = Math.sin(2 * Math.PI * i / g.days);
    out.push({ date: d.toISOString().slice(0, 10), tmin: g.tmin + g.amp * ph, tmax: g.tmax + g.amp * ph, et0: g.et0 + g.et0amp * ph,
      rain: (i % g.rainEvery === 0) ? g.rainMm : 0, u2: g.u2, rhmin: g.rhmin,
      ...(g.forecastLastDays && i >= g.days - g.forecastLastDays ? { kind: 'forecast', rainProb: g.rainProb } : {}) });
  }
  return out;
}
console.log(fail ? `\n${fail} test(s) FAILED` : '\nAll engine tests passed');
process.exit(fail ? 1 : 0);
