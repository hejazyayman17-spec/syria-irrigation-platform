/* GCSAR.WaterBalance — daily root-zone soil water balance and irrigation scheduling (FAO-56 Ch. 8, single Kc).
 * Mirrors the future C# class  GCSAR.Irrigation.Core.WaterBalanceEngine.
 *
 * Daily balance (Eq. 85, CR = 0):   Dr,i = Dr,i-1 − (P − RO)i − Ii + ETc,adj,i + DPi
 * Stress (Eq. 84):                  Ks = 1 if Dr ≤ RAW, else (TAW − Dr)/((1 − p)·TAW)
 * TAW (Eq. 82), RAW (Eq. 83), p adjusted for ETc (Table 22 footnote): p = p_tab + 0.04·(5 − ETc)
 *
 * Declared conventions (methodology guide: one convention, no double counting):
 *  - Rain enters as P − RO, with RO from the SCS curve-number method (daily, AMC II). No separate Peff.
 *  - Thermal-time phenology: stages, Kc curve and root depth are driven by GDD from sowing.
 *  - Growing root zone: the soil below the roots (down to Zr,max) is a second store with its own
 *    depletion Dsub. When roots deepen by ΔZr, the new slice brings its share of Dsub into Dr
 *    (Dr is NOT left unchanged — guide §9.2). Deep percolation from the root zone first refills
 *    Dsub; only the excess leaves the profile. The two stores together conserve mass, and the
 *    summary reports the closure error.
 *  - Ks is computed from Dr at the start of the day (end of the previous day), as in FAO-56.
 */
(function (root) {
  'use strict';
  const G = root.GCSAR = root.GCSAR || {};
  const F = () => G.Fao56;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

  /** Daily growing degree-days (average method, optional upper cutoff) */
  function gdd(tmin, tmax, tbase, tupper) {
    if (!Number.isFinite(tmin) || !Number.isFinite(tmax)) return 0;
    if (Number.isFinite(tupper)) { tmin = Math.min(tmin, tupper); tmax = Math.min(tmax, tupper); }
    return Math.max(0, (tmin + tmax) / 2 - tbase);
  }

  /** FAO-56 stage (0 initial, 1 development, 2 mid, 3 late, 4 after harvest) from cumulative GDD */
  function stageOf(g, s) { return g < s.iniEnd ? 0 : g < s.devEnd ? 1 : g < s.midEnd ? 2 : g < s.lateEnd ? 3 : 4; }
  const STAGE_NAMES = ['أولي', 'تطور', 'منتصف الموسم', 'نهاية الموسم', 'بعد الحصاد'];

  /** Four-stage Kc curve interpolated in thermal time (FAO-56 Fig. 25, Eq. 66 with GDD in place of days) */
  function kcAt(g, c, kcMid, kcEnd) {
    const s = c.gdd;
    if (g < s.iniEnd) return c.kcIni;
    if (g < s.devEnd) return c.kcIni + (kcMid - c.kcIni) * (g - s.iniEnd) / (s.devEnd - s.iniEnd);
    if (g < s.midEnd) return kcMid;
    if (g < s.lateEnd) return kcMid + (kcEnd - kcMid) * (g - s.midEnd) / (s.lateEnd - s.midEnd);
    return kcEnd;
  }

  /** Root depth: linear in thermal time from Zr,min at sowing to Zr,max at end of development (full cover) */
  function zrAt(g, c) { return c.zrMin + (c.zrMax - c.zrMin) * clamp(g / c.gdd.devEnd, 0, 1); }

  /** SCS curve-number runoff [mm] for daily rain P [mm] */
  function runoffSCS(P, cn) {
    if (!(P > 0) || !(cn > 0) || cn >= 100) return 0;
    const S = 25400 / cn - 254, Ia = 0.2 * S;
    return P > Ia ? (P - Ia) * (P - Ia) / (P + 0.8 * S) : 0;
  }

  /**
   * Run a season.
   * input = {
   *   crop:  CropParameters (see crops.js),
   *   soil:  { thetaFC, thetaWP, cn, initialDepletionFrac, subsoilDepletionFrac },
   *   irrigation: { mode: 'scheduled'|'actual'|'rainfed', efficiency, triggerFrac|null (null = RAW i.e. p), events:[{date,grossMm}],
   *                 maxNetMm|null (largest net depth one irrigation can apply; null = refill to FC),
   *                 forecastRainProbMin (%; forecast rain counts only when its probability ≥ this, default 60) },
   *   sowingDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD',
   *   weather: [{ date, tmin, tmax, et0, rain, u2, rhmin, kind, rainProb }]
   *            u2, rhmin optional (Kc climate adjustment); kind: 'obs' (default) | 'model' (recent analysis) | 'forecast'
   * }
   * Forecast days continue the same balance; their totals are reported separately (summary = observed + model days only).
   * returns { days:[DailyBalance], summary, recommendation, kcMidAdj, kcEndAdj }
   */
  function run(input) {
    const c = input.crop, soil = input.soil, irr = input.irrigation || { mode: 'rainfed' };
    const t0 = parseDate(input.sowingDate), t1 = parseDate(input.endDate);
    const wx = new Map(input.weather.map(w => [String(w.date).slice(0, 10), w]));
    const dTheta = soil.thetaFC - soil.thetaWP;
    if (!(dTheta > 0)) throw new Error('θFC يجب أن يكون أكبر من θWP');
    const ea = clamp(irr.efficiency || 1, 0.3, 1);
    const events = new Map((irr.events || []).map(e => [String(e.date).slice(0, 10), +e.grossMm || 0]));
    const maxNet = Number.isFinite(irr.maxNetMm) && irr.maxNetMm > 0 ? irr.maxNetMm : Infinity;
    const probMin = Number.isFinite(irr.forecastRainProbMin) ? irr.forecastRainProbMin : 60;

    // ---- pass 1: thermal time per day → mean u2 & RHmin over mid and late stages → adjusted Kc mid/end (Eq. 62)
    const dates = [];
    for (let d = new Date(t0); d <= t1; d.setDate(d.getDate() + 1)) dates.push(iso(d));
    let cum = 0; const g = [];
    for (const k of dates) { const w = wx.get(k); cum += w ? gdd(w.tmin, w.tmax, c.tbase, c.tupper) : 0; g.push(cum); }
    // the season ends at harvest maturity (GDD ≥ lateEnd): later days are not part of the crop water balance
    const hv = g.findIndex(x => x >= c.gdd.lateEnd);
    if (hv >= 0) { dates.length = hv + 1; g.length = hv + 1; }
    const meanOver = (stage, f) => { const v = dates.map((k, i) => stageOf(g[i], c.gdd) === stage ? f(wx.get(k)) : null).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const adj = (kc, st) => { const u = meanOver(st, w => w && w.u2), rh = meanOver(st, w => w && w.rhmin); return (u === null || rh === null) ? kc : F().kcClimateAdjust(kc, u, rh, c.h); };
    const kcMidAdj = adj(c.kcMid, 2);
    const kcEndAdj = c.kcEnd >= 0.45 ? adj(c.kcEnd, 3) : c.kcEnd;   // Eq. 65 applies only when Kc end ≥ 0.45

    // ---- pass 2: daily balance
    let zrPrev = c.zrMin;
    let Dr = clamp(soil.initialDepletionFrac ?? 0.5, 0, 1) * 1000 * dTheta * zrPrev;
    let Dsub = clamp(soil.subsoilDepletionFrac ?? 0, 0, 1) * 1000 * dTheta * Math.max(0, c.zrMax - zrPrev);
    const store0 = Dr + Dsub;
    const days = [];
    const tot = { P: 0, RO: 0, Inet: 0, Igross: 0, ETc: 0, ETcAdj: 0, DP: 0, stressDays: 0, missing: 0, irrigations: 0 };   // observed + model days
    const fc = { P: 0, RO: 0, Inet: 0, Igross: 0, ETc: 0, ETcAdj: 0, DP: 0, stressDays: 0, missing: 0, irrigations: 0 };    // forecast days
    let pendingAuto = 0; // net mm decided at the end of yesterday, applied today

    dates.forEach((k, i) => {
      const w = wx.get(k);
      const kind = (w && w.kind) || 'obs', isFc = kind === 'forecast';
      const G_ = g[i], st = stageOf(G_, c.gdd), kc = st === 4 ? null : kcAt(G_, c, kcMidAdj, kcEndAdj);
      const zr = zrAt(G_, c);
      // root growth: bring the new slice's share of subsoil depletion into the root zone
      if (zr > zrPrev + 1e-9) {
        const thick = c.zrMax - zrPrev;
        const take = thick > 0 ? Dsub * (zr - zrPrev) / thick : 0;
        Dr += take; Dsub -= take;
      }
      zrPrev = zr;
      const TAW = 1000 * dTheta * zr;
      const et0 = w && Number.isFinite(w.et0) ? w.et0 : null;
      const ETc = kc !== null && et0 !== null ? kc * et0 : 0;
      const p = clamp(c.p + 0.04 * (5 - ETc), 0.1, 0.8);
      const RAW = p * TAW;
      const Ks = Dr <= RAW ? 1 : clamp((TAW - Dr) / ((1 - p) * TAW), 0, 1);
      const ETcAdj = Ks * ETc;
      const rainRaw = w && Number.isFinite(w.rain) ? Math.max(0, w.rain) : 0;
      const rainProb = w && Number.isFinite(w.rainProb) ? w.rainProb : null;
      // forecast rain enters the balance only when likely enough (decision rule, not a probability-weighted amount)
      const P = isFc && rainProb !== null && rainProb < probMin ? 0 : rainRaw;
      const RO = runoffSCS(P, soil.cn);
      // irrigation today: recorded events (gross → net with Ea) + automatic recommendation from yesterday
      let Igross = 0, Inet = 0, auto = false;
      if (irr.mode !== 'rainfed' && events.has(k)) { Igross += events.get(k); Inet += events.get(k) * ea; }
      if (irr.mode === 'scheduled' && pendingAuto > 0) { Inet += pendingAuto; Igross += pendingAuto / ea; auto = true; }
      pendingAuto = 0;
      // balance
      let DrNew = Dr - (P - RO) - Inet + ETcAdj;
      let DP = 0, recharge = 0;
      if (DrNew < 0) { DP = -DrNew; DrNew = 0; recharge = Math.min(DP, Dsub); Dsub -= recharge; DP -= recharge; }
      DrNew = Math.min(DrNew, TAW);
      Dr = DrNew;
      // decision for tomorrow (crop still in the field)
      const trig = (irr.triggerFrac ?? p) * TAW;
      const needs = st < 4 && Dr >= trig;
      if (irr.mode === 'scheduled' && needs) pendingAuto = Math.min(Dr, maxNet);   // refill to FC, limited by the system's max net depth
      const T = isFc ? fc : tot;
      if (Ks < 1) T.stressDays++;
      if (Inet > 0) T.irrigations++;
      if (!w || et0 === null) T.missing++;
      T.P += P; T.RO += RO; T.Inet += Inet; T.Igross += Igross; T.ETc += ETc; T.ETcAdj += ETcAdj; T.DP += DP;
      days.push({ Date: k, GDD: +G_.toFixed(1), Stage: st, StageName: STAGE_NAMES[st], Kc: kc === null ? null : +kc.toFixed(3),
        Zr: +zr.toFixed(3), TAW: +TAW.toFixed(1), RAW: +RAW.toFixed(1), p: +p.toFixed(3), ET0: et0 === null ? null : +et0.toFixed(2),
        ETc: +ETc.toFixed(2), Ks: +Ks.toFixed(3), ETcAdj: +ETcAdj.toFixed(2), P: +P.toFixed(1), RO: +RO.toFixed(1),
        Inet: +Inet.toFixed(1), Igross: +Igross.toFixed(1), AutoIrrigation: auto, DP: +DP.toFixed(1), Recharge: +recharge.toFixed(1),
        Dr: +Dr.toFixed(1), Dsub: +Dsub.toFixed(1), Trigger: +trig.toFixed(1), NeedsIrrigation: needs, MissingWeather: et0 === null,
        Kind: kind, RainForecast: isFc ? +rainRaw.toFixed(1) : null, RainProb: rainProb });
    });

    // mass closure: water gained by the profile (= decrease of total depletion) must equal inputs − outputs
    const store1 = Dr + Dsub;
    const all = k => tot[k] + fc[k];
    const closure = (store0 - store1) - ((all('P') - all('RO')) + all('Inet') - all('ETcAdj') - all('DP'));
    const ratio = tot.ETc > 0 ? tot.ETcAdj / tot.ETc : 1;
    const summary = {
      ...Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])),
      ETcAdjOverETc: +ratio.toFixed(3),
      YieldReductionPct: c.ky ? +(100 * c.ky * (1 - ratio)).toFixed(1) : null,   // FAO-33: 1 − Ya/Ym = Ky (1 − ETa/ETm)
      MassClosureMm: +closure.toFixed(3),
      KcMidAdj: +kcMidAdj.toFixed(3), KcEndAdj: +kcEndAdj.toFixed(3)
    };
    const forecast = Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, +v.toFixed(1)]));
    return { days, summary, forecast, recommendation: recommend(days, ea, maxNet, probMin), kcMidAdj, kcEndAdj };
  }

  /** Irrigation advice.
   *  today  — on the last non-forecast day ("now"): irrigate (net limited by maxNet) or days until the trigger.
   *  alert  — over the forecast days: first date the trigger is reached, the planned irrigations (scheduled mode),
   *           forecast rain (counted / all) and ET0 over the horizon.  level: 'now' | 'soon' | 'ok' | 'harvested' */
  function recommend(days, ea, maxNet = Infinity, probMin = 60) {
    if (!days.length) return null;
    const m3PerDunum = mm => mm * 1.0;   // 1 mm over 1 dunum (1000 m²) = 1 m³
    let li = days.length - 1; while (li > 0 && days[li].Kind === 'forecast') li--;
    const last = days[li], fdays = days.slice(li + 1).filter(d => d.Kind === 'forecast');
    const harvestDay = days.find(d => d.Stage === 4);
    let today;
    if (last.Stage === 4) today = { action: 'harvested', date: last.Date };
    else if (last.NeedsIrrigation) {
      const net = Math.min(last.Dr, maxNet), gross = net / ea;
      today = { action: 'irrigate', date: last.Date, netMm: +net.toFixed(1), grossMm: +gross.toFixed(1), m3PerDunum: +m3PerDunum(gross).toFixed(1),
        remainingMm: +(last.Dr - net).toFixed(1), limited: last.Dr > maxNet, Dr: last.Dr, trigger: last.Trigger, TAW: last.TAW };
    } else {
      const recent = days.slice(Math.max(0, li - 6), li + 1).map(d => d.ETcAdj).filter(x => x > 0);
      const rate = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
      today = { action: 'wait', date: last.Date, daysUntil: rate ? Math.max(0, Math.floor((last.Trigger - last.Dr) / rate)) : null,
        rateMmDay: rate === null ? null : +rate.toFixed(2), Dr: last.Dr, trigger: last.Trigger, TAW: last.TAW };
    }
    let alert = null;
    if (fdays.length) {
      const sum = f => +fdays.reduce((a, d) => a + (f(d) || 0), 0).toFixed(1);
      const need = fdays.find(d => d.NeedsIrrigation);
      const plan = fdays.filter(d => d.AutoIrrigation && d.Inet > 0).map(d => ({ date: d.Date, netMm: d.Inet, grossMm: d.Igross, m3PerDunum: +m3PerDunum(d.Igross).toFixed(1) }));
      const level = today.action === 'harvested' ? 'harvested' : today.action === 'irrigate' ? 'now' : need ? 'soon' : 'ok';
      alert = { level, from: fdays[0].Date, to: fdays[fdays.length - 1].Date, days: fdays.length,
        firstNeedDate: need ? need.Date : null, plan,
        rainCountedMm: sum(d => d.P), rainAllMm: sum(d => d.RainForecast), probMin,
        rainDays: fdays.filter(d => (d.RainForecast || 0) >= 1).map(d => ({ date: d.Date, mm: d.RainForecast, prob: d.RainProb })),
        et0Mm: sum(d => d.ET0), etcAdjMm: sum(d => d.ETcAdj), stressDays: fdays.filter(d => d.Ks < 1).length,
        harvestInHorizon: harvestDay && harvestDay.Kind === 'forecast' ? harvestDay.Date : null };
    }
    return { ...today, today, alert };
  }

  G.WaterBalance = { run, gdd, kcAt, zrAt, stageOf, runoffSCS, STAGE_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
