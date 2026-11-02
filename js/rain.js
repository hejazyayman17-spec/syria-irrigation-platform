/* Daily rain for the water balance: NASA POWER timing, CHIRPS v3 monthly amount ("hybrid", default).
 *
 *   P_day = P_NASA,day × CHIRPS_month(site) / NASA_month(cell)
 *
 * Why (tools/rain_eval, 10 reference stations, 224 rain years 1995–2022, rain year 1 Sep–31 Aug):
 *   NASA raw    bias −17 %  RMSE 184 mm  (dry −2 %, normal −16 %, wet −26 %; Homs −40 %, Quneitra −42 %)
 *   CHIRPS      bias  +6 %  RMSE 137 mm  (dry +24 %, normal +11 %, wet −6 %)
 *   Hybrid daily: same rain-day detection as NASA, heavy-day (≥20 mm) rain recovered 0.24–0.45 → 0.41–0.84.
 *   2025/26 east: NASA Deir ez-Zor 527 mm (3.7× median) vs CHIRPS 232; Mafraq Sep–Jan gauge 118, NASA 226, CHIRPS 100.
 * Rules per month (the NASA cell's daily series, the CHIRPS 0.1° box containing the site):
 *   CHIRPS month not published yet, or the NASA month incomplete → raw NASA, marked 'provisional'.
 *   NASA month ≥ 1 mm → scaled ('chirps').   NASA month < 1 mm → raw NASA kept ('chirps' when CHIRPS < 1 mm too,
 *   otherwise 'grid': CHIRPS rain with no NASA rain day to place it on is not invented).
 * Known limits shown to the user: CHIRPS over-reads dry years (~+24 %), mountains above ~900 m (+70 % at one
 * reference station), and the east / steppe has no ground check (station records interrupted since 2012).
 */
(function () {
  'use strict';
  const LS = 'gcsar.rain.v1', FILES = new Map();
  let product = 'hybrid';
  try { const v = localStorage.getItem(LS); if (v === 'nasa' || v === 'hybrid') product = v; } catch (e) { }

  const base = () => { try { const b = archiveBase(); return b ? b.replace('data/nasa/', 'data/rain/chirps/') : null; } catch (e) { return null; } };
  async function load(y) {
    if (!FILES.has(y)) FILES.set(y, (async () => {
      const b = base(); if (!b) return null;
      try { const r = await fetch(b + `${y}.json`, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch (e) { return null; }
    })());
    return FILES.get(y);
  }
  /** CHIRPS monthly total (mm) of the 0.1° box containing (lat, lon); nearest valid neighbour box if that one has no data. */
  function boxValue(f, k, lat, lon) {
    const g = f && f.grid; if (!g) return null;
    const i0 = Math.floor((lat - g.lat0) / g.step), j0 = Math.floor((lon - g.lon0) / g.step), v = f.v[k];
    for (let r = 0; r <= 1; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= g.nlat || j >= g.nlon) continue;
      const x = v[i * g.nlon + j]; if (x >= 0) return x / 10;
    }
    return null;
  }
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /** dates8 = NASA archive dates 'YYYYMMDD' of one year file, pr = that cell's PRECTOTCORR. Returns the hybrid series {rain[], src[], months}. */
  async function adjust(lat, lon, dates8, pr) {
    const rain = pr.map(v => v ?? null), src = pr.map(() => 'grid');
    if (!dates8.length) return { rain, src, months: { scaled: 0, provisional: 0 } };   // computed whatever the product; the caller picks
    const y = +dates8[0].slice(0, 4), f = await load(y), groups = new Map();
    dates8.forEach((d, j) => { const k = d.slice(0, 6); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); });
    let scaled = 0, provisional = 0;
    for (const [ym, js] of groups) {
      const mk = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`, k = f ? f.months.indexOf(mk) : -1;
      const complete = js.length === dim(+ym.slice(0, 4), +ym.slice(4, 6)) && js.every(j => pr[j] !== null && pr[j] !== undefined);
      const c = k >= 0 ? boxValue(f, k, lat, lon) : null;
      if (c === null || !complete) { js.forEach(j => { src[j] = 'provisional'; }); provisional++; continue; }
      const n = js.reduce((a, j) => a + pr[j], 0);
      if (n >= 1) { const fac = c / n; js.forEach(j => { rain[j] = pr[j] * fac; src[j] = 'chirps'; }); scaled++; }
      else { js.forEach(j => { src[j] = c < 1 ? 'chirps' : 'grid'; }); if (c < 1) scaled++; }   // dry month agreed by both
    }
    return { rain, src, months: { scaled, provisional } };
  }

  /** mean CHIRPS rain-year total (Sep–Aug, complete years only) at the site, from the stored years */
  async function annualMean(lat, lon) {
    const idx = await (async () => { const b = base(); if (!b) return null; try { const r = await fetch(b + 'index.json', { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch (e) { return null; } })();
    if (!idx) return null;
    const tot = new Map(), cnt = new Map();
    for (const y of idx.years) {
      const f = await load(y); if (!f) continue;
      f.months.forEach((mk, k) => { const m = +mk.slice(5, 7), ry = m >= 9 ? y : y - 1, v = boxValue(f, k, lat, lon);
        if (v !== null) { tot.set(ry, (tot.get(ry) || 0) + v); cnt.set(ry, (cnt.get(ry) || 0) + 1); } });
    }
    const full = [...tot].filter(([ry]) => cnt.get(ry) === 12).map(([, v]) => v);
    return full.length ? { mean: full.reduce((a, b) => a + b, 0) / full.length, years: full.length } : null;
  }

  /** limitation notes for a site (shown under the run) */
  function warnings(lat, lon, elev, annual) {
    const w = [];
    if (lon >= 38.0 || (annual && annual.mean < 200))
      w.push('المطر غير متحقَّق منه أرضياً في هذه المنطقة (الشرق والبادية: سجلات المحطات منقطعة منذ 2012) — يُفضَّل إدخال مطر مقاس من الحقل');
    if (product === 'hybrid' && Number.isFinite(elev) && elev > 900)
      w.push(`الموقع على ارتفاع ${Math.round(elev)} م: قد يضخّم CHIRPS المطر في المرتفعات فوق 900 م — تعامل مع المطر بحذر`);
    return w;
  }

  const LABEL = { hybrid: 'ناسا اليومي معايَر على مجموع CHIRPS v3 الشهري', nasa: 'ناسا الخام (PRECTOTCORR)' };
  function summary(m) {
    if (product !== 'hybrid') return `المطر: ${LABEL.nasa}`;
    return `المطر: ${LABEL.hybrid}${m ? ` — ${m.scaled} شهراً معايَراً${m.provisional ? `، ${m.provisional} مؤقت (ناسا خام حتى صدور CHIRPS)` : ''}` : ''}`;
  }
  /** the series the run uses: hybrid → (rain, src); raw → (NASA, 'grid') */
  const pick = (adj, pr, j) => product === 'hybrid' ? { mm: adj.rain[j], src: adj.src[j] } : { mm: pr[j], src: 'grid' };
  function set(p) { product = p === 'nasa' ? 'nasa' : 'hybrid'; try { localStorage.setItem(LS, product); } catch (e) { } }

  window.RAIN = { adjust, pick, load, boxValue, annualMean, warnings, summary, set, get product() { return product; }, LABEL };
})();
