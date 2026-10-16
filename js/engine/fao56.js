/* GCSAR.Fao56 — FAO-56 reference evapotranspiration and climate helpers.
 * Pure functions, no DOM. Mirrors the future C# class  GCSAR.Irrigation.Core.Fao56.
 * Equation numbers: Allen et al. (1998), FAO Irrigation and Drainage Paper 56.
 * Validated: FAO-56 Example 18 (Uccle, 6 July) → ET0 = 3.88 mm/day (published 3.9).
 */
(function (root) {
  'use strict';
  const G = root.GCSAR = root.GCSAR || {};

  const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null));

  /** Saturation vapour pressure e°(T) [kPa] — Eq. 11 */
  const e0 = T => 0.6108 * Math.exp(17.27 * T / (T + 237.3));

  /** Wind speed at 2 m from height z [m] — Eq. 47 (log profile, short grass) */
  function wind2m(u, z) {
    if (!Number.isFinite(u)) return null;
    if (!Number.isFinite(z) || z <= 0 || Math.abs(z - 2) < 0.01) return u;
    return u * 4.87 / Math.log(67.8 * z - 5.42);
  }

  /** Day of year 1..366 (local calendar date) */
  function doy(d) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); }

  /** Daily FAO-56 Penman–Monteith ET0 [mm/day] — Eq. 6, G = 0 (Eq. 42).
   * rec: Tmin_C, Tmax_C, WindSpeed_m_s, WindHeight_m, SolarRadiation_MJ_m2_day,
   *      RHmin_pct+RHmax_pct | DewPoint_C | RHmean_pct  (priority in that order)
   * meta: Latitude, Elevation_m, WindHeight_m;  date: JS Date */
  function et0FromRecord(rec, meta, date) {
    const Tmin = num(rec.Tmin_C), Tmax = num(rec.Tmax_C), u = num(rec.WindSpeed_m_s),
      zh = num(rec.WindHeight_m) || num(meta.WindHeight_m) || 2, Rs = num(rec.SolarRadiation_MJ_m2_day),
      z = num(meta.Elevation_m), lat = num(meta.Latitude), d = date;
    if ([Tmin, Tmax, u, Rs, z, lat].some(v => v === null) || !d) return { et0: null, reason: 'نقص بيانات أساسية' };
    const T = (Tmin + Tmax) / 2, es = (e0(Tmax) + e0(Tmin)) / 2;                 // Eq. 9, 12
    let ea = null, humMethod = '';
    const rhmin = num(rec.RHmin_pct), rhmax = num(rec.RHmax_pct), rhmean = num(rec.RHmean_pct), td = num(rec.DewPoint_C);
    if (rhmin !== null && rhmax !== null) { ea = (e0(Tmin) * rhmax / 100 + e0(Tmax) * rhmin / 100) / 2; humMethod = 'RHmin/RHmax'; } // Eq. 17
    else if (td !== null) { ea = e0(td); humMethod = 'Tdew'; }                                                                 // Eq. 14
    else if (rhmean !== null) { ea = es * rhmean / 100; humMethod = 'RHmean approx'; }                                         // Eq. 19
    else return { et0: null, reason: 'الرطوبة غير كافية' };
    const delta = 4098 * e0(T) / Math.pow(T + 237.3, 2);                          // Eq. 13
    const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26), gamma = 0.000665 * P; // Eq. 7, 8
    const J = doy(d), phi = lat * Math.PI / 180;
    const dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365);                       // Eq. 23
    const sd = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39);                    // Eq. 24
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(sd)))); // Eq. 25
    const Ra = (24 * 60 / Math.PI) * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(sd) + Math.cos(phi) * Math.cos(sd) * Math.sin(ws)); // Eq. 21
    const Rso = (0.75 + 2e-5 * z) * Ra;                                           // Eq. 37
    const Rns = 0.77 * Rs;                                                        // Eq. 38 (albedo 0.23)
    const ratio = Rso > 0 ? Math.max(0, Math.min(1, Rs / Rso)) : 1;
    const cloud = Math.max(0.05, Math.min(1, 1.35 * ratio - 0.35));
    const Rnl = 4.903e-9 * (Math.pow(Tmax + 273.16, 4) + Math.pow(Tmin + 273.16, 4)) / 2 * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) * cloud; // Eq. 39
    const Rn = Rns - Rnl;                                                         // Eq. 40
    const u2 = wind2m(u, zh);
    const et = (0.408 * delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2)); // Eq. 6
    return { et0: Math.max(0, et), u2, humMethod, Ra, Rn, es, ea };
  }

  /** Daily minimum relative humidity [%] — measured, or estimated from Tdew and Tmax
   * (FAO-56 Eq. 63 basis: RHmin ≈ 100·e°(Tdew)/e°(Tmax)). */
  function rhMin(rec) {
    const r = num(rec.RHmin_pct); if (r !== null) return r;
    const td = num(rec.DewPoint_C), tx = num(rec.Tmax_C);
    if (td !== null && tx !== null) return Math.min(100, 100 * e0(td) / e0(tx));
    return null;
  }

  /** Climatic adjustment of Kc mid / Kc end — Eq. 62 (and Eq. 65 for Kc end ≥ 0.45).
   * u2 limited to 1–6 m/s, RHmin to 20–80 %, h = mean crop height [m]. */
  function kcClimateAdjust(kcTab, u2, rhmin, h) {
    if (!Number.isFinite(u2) || !Number.isFinite(rhmin)) return kcTab;
    const u = Math.max(1, Math.min(6, u2)), rh = Math.max(20, Math.min(80, rhmin));
    return kcTab + (0.04 * (u - 2) - 0.004 * (rh - 45)) * Math.pow(h / 3, 0.3);
  }

  G.Fao56 = { e0, wind2m, doy, et0FromRecord, rhMin, kcClimateAdjust, num };
})(typeof window !== 'undefined' ? window : globalThis);
