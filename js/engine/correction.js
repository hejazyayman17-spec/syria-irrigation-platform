/* GCSAR.Correction — correction of NASA POWER daily inputs for a site, then FAO-56 ET0 with an error band.
 * Line-for-line port of the C# library GCSAR.ClimateCorrection (CorrectionEngine, Harmonic, Grid, Fao56), itself a
 * port of the research code (nashabiyah-nasa-power). Parity with the reference cases: tests/vectors/09 (tolerance 1e-9).
 * Do not edit the equations here by hand: they must stay identical to the research code (rule of the hand-over).
 *
 * Method (fixed order): correct each input with its day-of-year equation, THEN recompute ET0.
 * Never correct the final ET0 alone — part of the error is interactive (wind × vapour-pressure deficit, 15–31 %).
 *   c(d) = a0 + a1 cos(ωd) + b1 sin(ωd) + a2 cos(2ωd) + b2 sin(2ωd),  ω = 2π/365.25
 *   additive  (Tmax, Tmin, Tdew):  ground = NASA + c(d)
 *   multiplicative (Rs, u2):       ground = NASA × c(d)
 * Levels: 3 cell equation (reference station in the site's NASA cell) · 2 regional equation · 1 raw T/RH + wind factor.
 * Wind priority: measured factor > the cell's wind equation (same site type) > default factor of the site type.
 * Error band (mm/d) = √(base² + wind²): base = the cell's monthly ET0 RMSE | 0.5 regional | 0.8 raw;
 * wind = the default factor's uncertainty acting on the aerodynamic term only (0 when wind was measured).
 * The coefficient model (correction_coefficients.json) is passed in — the engine has no data of its own.
 */
(function (root) {
  'use strict';
  const G = root.GCSAR = root.GCSAR || {};

  // ---------- Harmonic.cs
  const OMEGA = 2.0 * Math.PI / 365.25;
  function hEval(c, doy) { let v = c[0]; for (let k = 1; 2 * k <= c.length - 1; k++) v += c[2 * k - 1] * Math.cos(k * OMEGA * doy) + c[2 * k] * Math.sin(k * OMEGA * doy); return v; }
  const applyAdd = (c, doy, x) => x + hEval(c, doy);
  const applyMul = (c, doy, x) => x * hEval(c, doy);

  // ---------- Grid.cs (MERRA-2 meteorology cell 0.5° × 0.625°)
  const round4 = x => Math.round(x * 1e4) / 1e4;
  const cellCentre = (lat, lon) => [round4(0.5 * Math.floor(lat / 0.5 + 0.5)), round4(0.625 * Math.floor(lon / 0.625 + 0.5))];
  function sameCell(lat, lon, cLat, cLon) { const [a, b] = cellCentre(lat, lon); return Math.abs(a - cLat) < 1e-6 && Math.abs(b - cLon) < 1e-6; }

  // ---------- Fao56.cs (the research variant: Rs/Rso clamped to 0.25–1.0 in Eq. 39)
  const es = t => 0.6108 * Math.exp(17.27 * t / (t + 237.3));
  const gamma = z => 0.000665 * 101.3 * Math.pow((293.0 - 0.0065 * z) / 293.0, 5.26);
  function extraterrestrial(doy, latDeg) {
    const lat = latDeg * Math.PI / 180.0, dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365.0), dec = 0.409 * Math.sin(2 * Math.PI * doy / 365.0 - 1.39);
    const ws = Math.acos(-Math.tan(lat) * Math.tan(dec));
    return { ra: 24.0 * 60.0 / Math.PI * 0.0820 * dr * (ws * Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.sin(ws)), n: 24.0 / Math.PI * ws };
  }
  const clearSky = (ra, z) => (0.75 + 2e-5 * z) * ra;
  function pmTerms(tmax, tmin, ea, rs, u2, rso, z) {
    const g = gamma(z), t = (tmax + tmin) / 2.0, esd = (es(tmax) + es(tmin)) / 2.0, delta = 4098.0 * es(t) / Math.pow(t + 237.3, 2);
    const rnl = 4.903e-9 * (Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2.0 * (0.34 - 0.14 * Math.sqrt(ea))
      * (1.35 * Math.min(1.0, Math.max(0.25, rs / rso)) - 0.35);
    const rn = 0.77 * rs - rnl, den = delta + g * (1 + 0.34 * u2);
    return { radiative: 0.408 * delta * rn / den, aerodynamic: g * 900.0 / (t + 273.0) * u2 * (esd - ea) / den };
  }
  const pm = (...a) => { const r = pmTerms(...a); return r.radiative + r.aerodynamic; };

  // day of year of a 'YYYY-MM-DD' date (calendar, time-zone free) — DateTime.DayOfYear
  function doyOf(iso) { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1; }
  const monthOf = iso => +String(iso).slice(5, 7);

  const LEVEL_AR = { 3: 'المستوى 3 — معادلة الخلية', 2: 'المستوى 2 — معادلة إقليمية', 1: 'المستوى 1 — ناسا خام + معامل رياح', 0: 'ناسا خام' };
  const SITE_AR = { protected: 'محمي', ordinary: 'عادي', exposed: 'مكشوف' };

  /** Engine bound to one coefficient model. site = { lat, lon, elevationM, siteType: 'protected'|'ordinary'|'exposed', measuredWindFactor|null } */
  function engine(model) {
    const inBox = (r, lat, lon) => r.bbox && r.bbox.length === 4 && lat >= r.bbox[0] && lon >= r.bbox[1] && lat <= r.bbox[2] && lon <= r.bbox[3];
    const inLimit = (l, lat, lon) => lat >= l.lat[0] && lat <= l.lat[1] && lon >= l.lon[0] && lon <= l.lon[1];

    function resolve(site) {
      const cell = model.cells.find(c => sameCell(site.lat, site.lon, c.cell_lat, c.cell_lon)) || null;
      const region = cell ? null : (model.regions.find(r => inBox(r, site.lat, site.lon)) || null);
      const level = cell ? 3 : region ? 2 : 1;
      const key = site.siteType || 'ordinary';
      let windSource, windFactor = 1.0, windUnc;
      if (Number.isFinite(site.measuredWindFactor)) { windSource = 'measured'; windFactor = site.measuredWindFactor; windUnc = 0; }
      else if (cell && cell.u2 && cell.site_type === key) { windSource = 'cell'; windUnc = 0; }
      else { const d = model.wind_defaults[key]; windSource = 'default'; windFactor = d.factor; windUnc = d.uncertainty_pct; }
      const warnings = [];
      for (const l of model.limits) if (inLimit(l, site.lat, site.lon)) warnings.push(l.message_ar);
      if (cell) warnings.push(...(cell.notes_ar || []));
      if (cell && cell.u2 && windSource === 'default') warnings.push(`معادلة رياح الخلية خاصة بموقع «${cell.site_type}»؛ استُخدم المعامل الافتراضي لنوع موقعك`);
      if (level === 1) warnings.push('لا محطة مرجعية في الخلية ولا إقليم معتمد: الحرارة والرطوبة من ناسا دون تصحيح؛ الهامش واسع');
      if (windSource === 'default') warnings.push('الرياح بمعامل افتراضي: قياس رياح لسنة واحدة في الموقع يضيّق هامش الخطأ أكثر من أي تصحيح آخر');
      const description = level === 3 ? `معادلة الخلية: ${cell.name_ar} (محطة مرجعية: ${cell.reference_station})`
        : level === 2 ? `معادلة إقليمية: ${region.name_ar}` : 'ناسا خام للحرارة والرطوبة + معامل رياح';
      return { level, levelAr: LEVEL_AR[level], cell, region, windSource, windFactor, windUncertaintyPct: windUnc, warnings, description,
        cellId: cellCentre(site.lat, site.lon).join('_') };
    }

    /** day = { date:'YYYY-MM-DD', tmax, tmin, tdew, rs, ws2m } (NASA POWER, community AG) */
    function correct(site, day, r) {
      r = r || resolve(site);
      const doy = doyOf(day.date), C = r.cell, R = r.region;
      const tx = (C && C.tmax) || (R && R.tmax) || null, tn = (C && C.tmin) || (R && R.tmin) || null, td = (C && C.tdew) || (R && R.tdew) || null;
      const tmax = tx ? applyAdd(tx, doy, day.tmax) : day.tmax;
      const tmin = tn ? applyAdd(tn, doy, day.tmin) : day.tmin;
      const tdew = Math.min(td ? applyAdd(td, doy, day.tdew) : day.tdew, tmin);
      const rs = C && C.rs ? applyMul(C.rs, doy, day.rs) : day.rs;
      const u2 = r.windSource === 'cell' ? applyMul(C.u2, doy, day.ws2m) : day.ws2m * r.windFactor;
      const ra = extraterrestrial(doy, site.lat).ra, rso = clearSky(ra, site.elevationM);
      const et0Raw = pm(day.tmax, day.tmin, es(Math.min(day.tdew, day.tmin)), day.rs, day.ws2m, rso, site.elevationM);
      const t = pmTerms(tmax, tmin, es(tdew), rs, u2, rso, site.elevationM), et0 = t.radiative + t.aerodynamic;
      const base = r.level === 3 && C.et0_rmse_mm_monthly && C.et0_rmse_mm_monthly.length === 12 ? C.et0_rmse_mm_monthly[monthOf(day.date) - 1]
        : r.level === 2 ? model.uncertainty_defaults.regional_mm : model.uncertainty_defaults.raw_t_rh_mm;
      const windMm = r.windUncertaintyPct / 100.0 * t.aerodynamic, unc = Math.sqrt(base * base + windMm * windMm);
      return { date: day.date, tmax, tmin, tdew, rs, u2, et0Raw, et0, unc, et0Low: Math.max(0, et0 - unc), et0High: et0 + unc, level: r.level };
    }

    return { model, resolve, correct, correctSeries: (site, days) => { const r = resolve(site); return days.map(d => correct(site, d, r)); } };
  }

  /** Agreement statistics of simulated vs observed (same metrics as the research tables). */
  function agreement(obs, sim) {
    const p = obs.map((o, i) => [o, sim[i]]).filter(([o, s]) => Number.isFinite(o) && Number.isFinite(s)), n = p.length;
    if (n < 3) return null;
    const mo = p.reduce((a, [o]) => a + o, 0) / n, ms = p.reduce((a, [, s]) => a + s, 0) / n;
    let se = 0, ae = 0, so = 0, ss = 0, sos = 0, dd = 0;
    for (const [o, s] of p) { const e = s - o; se += e * e; ae += Math.abs(e); so += (o - mo) ** 2; ss += (s - ms) ** 2; sos += (o - mo) * (s - ms); dd += (Math.abs(s - mo) + Math.abs(o - mo)) ** 2; }
    const rmse = Math.sqrt(se / n), r = sos / Math.sqrt(so * ss), alpha = Math.sqrt(ss / n) / Math.sqrt(so / n), beta = ms / mo;
    return { n, mean_obs: mo, mean_sim: ms, MBE: ms - mo, MAE: ae / n, RMSE: rmse, nRMSE: 100 * rmse / mo, d: 1 - se / dd, NSE: 1 - se / so,
      KGE: 1 - Math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2), r, bias_pct: 100 * (ms - mo) / mo };
  }

  G.Correction = { engine, agreement, hEval, cellCentre, doyOf, LEVEL_AR, SITE_AR, fao: { es, gamma, extraterrestrial, clearSky, pmTerms } };
})(typeof window !== 'undefined' ? window : globalThis);
