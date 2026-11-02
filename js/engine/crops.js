/* GCSAR.Crops — crop parameter library (FAO-56 initial values, to be calibrated locally).
 * Mirrors the future C# class  GCSAR.Irrigation.Core.CropLibrary  (and the CropParameters record).
 *
 * Stage boundaries are expressed in thermal time (GDD, °C·day from sowing) instead of days,
 * so the FAO-56 four-stage Kc curve follows the season's actual temperature (decision in the
 * methodology guide: phenology drives Kc, Zr and p). The GDD boundaries below are INITIAL
 * test values derived from the platform's phenology presets; calibrate per variety/region.
 *
 * Sources:  Kc — FAO-56 Table 12;  Zr max, p — Table 22;  h — Table 12;  Ky — FAO-33.
 */
(function (root) {
  'use strict';
  const G = root.GCSAR = root.GCSAR || {};

  const CROPS = {
    wheat: {
      key: 'wheat', name: 'قمح — FAO-56 بأطوار حرارية', sowMonthDay: '11-20',
      kcIni: 0.70,   // Table 12: winter wheat, non-frozen soils (Syrian winter rains wet the surface often)
      kcMid: 1.15, kcEnd: 0.30, h: 1.0,
      zrMin: 0.20, zrMax: 1.50,   // Table 22: 1.5–1.8 m; lower bound used (calibrate to soil depth)
      p: 0.55,                    // Table 22 (for ETc ≈ 5 mm/day; adjusted daily)
      ky: 1.05,                   // FAO-33 winter wheat, whole season
      tbase: 0, tupper: null,
      // Derived from NASA POWER, Salamiyah cell, sowing 20 Nov 2025, at typical Syrian wheat dates:
      // tillering ~31 Dec (548), full cover ~5 Apr (1597), senescence ~5 May (2098), maturity ~1 Jun (2640).
      // → stage lengths ≈ 41/95/30/27 days (FAO-56 Table 11, Mediterranean winter wheat: 30/140/40/30).
      gdd: { iniEnd: 550, devEnd: 1600, midEnd: 2100, lateEnd: 2600 },
      note: 'حدود الأطوار مشتقة من موسم 2025/26 في سلمية (NASA POWER، زراعة 20 تشرين الثاني): الإشطاء ≈ نهاية كانون الأول، التغطية الكاملة ≈ أوائل نيسان، بداية الشيخوخة ≈ أوائل أيار، النضج ≈ أوائل حزيران. تُعاير بأرصاد فينولوجية حقلية.'
    },
    barley: {
      key: 'barley', name: 'شعير — FAO-56 بأطوار حرارية', sowMonthDay: '11-15',
      kcIni: 0.70, kcMid: 1.15, kcEnd: 0.25, h: 1.0,
      zrMin: 0.20, zrMax: 1.20, p: 0.55, ky: null,
      tbase: 0, tupper: null,
      gdd: { iniEnd: 500, devEnd: 1450, midEnd: 1900, lateEnd: 2350 },   // ≈ two weeks earlier than wheat
      note: 'Kc ini مأخوذ مثل القمح الشتوي لنظام الأمطار الشتوية؛ حدود الأطوار أبكر من القمح بنحو أسبوعين. تُعاير محلياً.'
    },
    maize: {
      key: 'maize', name: 'ذرة صفراء (حبية) — FAO-56 بأطوار حرارية', sowMonthDay: '04-15',
      kcIni: 0.30, kcMid: 1.20, kcEnd: 0.35, h: 2.0,
      zrMin: 0.20, zrMax: 1.30, p: 0.55, ky: 1.25,
      tbase: 10, tupper: 30,
      gdd: { iniEnd: 200, devEnd: 750, midEnd: 1300, lateEnd: 1800 },
      note: 'Kc end = 0.35 للحصاد الجاف للحبوب (0.60 للحصاد الرطب).'
    }
  };

  // ---------- Local Syrian crop coefficients (Annex 1: field and vegetable crops; Annex 2: fruit trees), proposed for CROPWAT.
  // These crops use DAY-based FAO-56 stages (stageDays = [L1, L2, L3, L4]) — the form in which the annex gives them —
  // and their Kc values are LOCAL (kcLocal: true), so the FAO-56 Eq. 62 climatic adjustment is NOT applied to them.
  // Root depth: the annex range is used through its mid-point (zrMax); zrMin = 0.15 m for annuals, = zrMax for trees.
  // p: FAO-56 Table 22 (not given in the annex); h: FAO-56 Table 12 (only informative here).
  // Trees: the annex gives no start of the growing season; growthStart below is an ASSUMPTION to be set locally.
  const L = (key, name, group, ki, km, ke, sow, win, days, zr, p, h, tbase, note) => ({
    key, name, group, kcIni: ki, kcMid: km, kcEnd: ke, kcLocal: true, h, zrMin: Math.min(0.15, zr), zrMax: zr, p, ky: null,
    tbase, tupper: null, stageDays: days, gdd: null, sowMonthDay: sow, sowWindow: win, source: 'local-annex',
    note: note || `معاملات محلية سورية (الملحق ${group === 'الأشجار المثمرة' ? 2 : 1})${win ? `، موعد الزراعة المقترح ${win}` : ''}. الأطوار بالأيام ${days.join('/')} يوماً. لا يُطبَّق تعديل Kc المناخي لأن القيم محلية.` });
  const T = (key, name, ki, km, ke, days, zr, p, start, startAr) => ({ ...L(key, name, 'الأشجار المثمرة', ki, km, ke, start, '', days, zr, p, null, 10,
    `معاملات محلية سورية (الملحق 2)، فترة النمو ${days.reduce((a, b) => a + b, 0)} يوماً بأطوار ${days.join('/')}. بداية موسم النمو ${startAr} افتراض يُضبط محلياً (الملحق لا يحددها). لا يُطبَّق تعديل Kc المناخي لأن القيم محلية.`),
    zrMin: zr, perennial: true });
  const W = 'النجيليات والبقوليات', S = 'المحاصيل الصيفية', F = 'المحاصيل العلفية', M = 'المحاصيل الطبية والنباتات العطرية', V = 'المحاصيل الشتوية';
  const LOCAL = [
    L('wheat_l', 'قمح — معاملات محلية', W, 0.40, 1.06, 0.82, '11-15', '15/11–15/12', [15, 30, 35, 100], 0.675, 0.55, 1.0, 0),
    L('barley_l', 'شعير — معاملات محلية', W, 0.40, 1.05, 0.72, '11-15', '15/11–15/12', [15, 30, 35, 100], 0.675, 0.55, 1.0, 0),
    L('chickpea', 'حمص', W, 0.40, 1.05, 0.30, '12-15', '15/12–15/1', [20, 30, 40, 20], 0.525, 0.50, 0.4, 0),
    L('lentil', 'عدس', W, 0.42, 1.02, 0.41, '12-15', '15/12–15/1', [20, 30, 60, 40], 0.525, 0.50, 0.5, 0),
    L('fababean_green', 'فول أخضر', W, 0.50, 1.10, 0.80, '01-15', '15/1–15/2', [20, 30, 35, 15], 0.525, 0.45, 0.8, 0),
    L('tomato', 'بندورة', S, 0.50, 1.10, 0.58, '03-01', '1/3–15/4', [30, 40, 45, 30], 0.525, 0.40, 0.6, 10),
    L('eggplant', 'باذنجان', S, 0.50, 1.05, 0.75, '03-01', '1/3–15/4', [30, 45, 45, 40], 0.525, 0.45, 0.8, 10),
    L('pepper', 'فليفلة', S, 0.40, 1.01, 0.65, '03-01', '1/3–15/4', [30, 40, 45, 30], 0.525, 0.30, 0.7, 10),
    L('cucumber', 'خيار', S, 0.60, 1.00, 0.70, '04-01', '1/4–15/5', [20, 30, 40, 15], 0.525, 0.50, 0.3, 10),
    L('tobacco', 'تبغ', S, 0.35, 1.06, 0.75, '04-01', '1/4–30/4', [20, 55, 55, 25], 0.60, 0.50, 1.2, 10),
    L('bean', 'فاصولياء', S, 0.60, 1.06, 0.50, '05-01', '1/5–31/5', [20, 50, 55, 15], 0.60, 0.45, 0.4, 10),
    L('cotton', 'قطن', S, 0.40, 1.15, 0.85, '04-01', '1/4–30/4', [35, 35, 60, 20], 0.675, 0.65, 1.3, 12),
    L('watermelon', 'بطيخ', S, 0.40, 1.00, 0.75, '04-01', '1/4–15/5', [20, 30, 30, 30], 0.60, 0.40, 0.4, 10),
    L('sugarbeet', 'شوندر سكري', S, 0.40, 1.10, 0.60, '04-15', '15/4–15/5', [25, 35, 50, 50], 0.675, 0.55, 0.5, 3),
    L('maize_l', 'ذرة — معاملات محلية', F, 0.45, 1.01, 0.95, '05-01', '1/5–30/5', [30, 40, 40, 30], 0.60, 0.55, 2.0, 10),
    L('groundnut', 'فول سوداني', F, 0.40, 1.02, 0.63, '04-01', '1/4–30/4', [35, 45, 35, 25], 0.60, 0.50, 0.4, 10),
    L('sunflower', 'عباد الشمس', F, 0.35, 1.05, 0.60, '05-15', '15/5', [15, 45, 45, 15], 0.60, 0.45, 2.0, 8),
    L('soybean', 'فول صويا', F, 0.40, 1.13, 0.87, '05-15', '15/5', [20, 35, 50, 25], 0.60, 0.50, 0.75, 10),
    L('sorghum', 'ذرة بيضاء', F, 0.40, 1.15, 0.55, '05-15', '15/5', [30, 35, 40, 35], 0.60, 0.55, 1.5, 10),
    L('anise', 'يانسون', M, 0.31, 1.00, 0.75, '02-01', '1/2–15/3', [18, 55, 45, 15], 0.525, 0.50, 0.6, 5),
    L('cumin', 'كمون', M, 0.40, 1.00, 0.75, '02-01', '1/2–15/3', [20, 60, 50, 20], 0.525, 0.50, 0.4, 5),
    L('sesame', 'سمسم', M, 0.70, 0.95, 0.70, '04-15', '15/4–15/5', [40, 35, 35, 10], 0.525, 0.60, 1.0, 12),
    L('beet_autumn', 'شوندر خريفي', V, 0.50, 0.95, 0.70, '12-01', '1/12–15/1', [25, 35, 60, 45], 0.60, 0.50, 0.4, 3),
    L('garlic', 'ثوم', V, 0.60, 0.85, 0.70, '02-01', '1/2–15/3', [15, 45, 45, 15], 0.525, 0.30, 0.3, 0),
    L('carrot', 'جزر', V, 0.70, 1.05, 0.95, '12-01', '1/12–15/1', [25, 35, 60, 20], 0.60, 0.35, 0.3, 3),
    L('lettuce', 'خس', V, 0.70, 1.00, 0.95, '11-01', '1/11–1/2', [20, 30, 30, 25], 0.525, 0.30, 0.3, 2),
    L('spinach', 'سبانخ', V, 0.50, 0.95, 0.75, '11-01', '1/11–1/2', [20, 20, 25, 20], 0.525, 0.20, 0.3, 2),
    L('potato', 'بطاطا', V, 0.50, 1.20, 0.75, '12-15', '15/12–15/1', [30, 35, 50, 25], 0.60, 0.35, 0.6, 2),
    L('cabbage', 'ملفوف', V, 0.70, 1.05, 0.90, '11-01', '1/11–1/2', [40, 60, 50, 15], 0.45, 0.45, 0.4, 0),
    L('onion', 'بصل', V, 0.45, 1.05, 0.80, '12-15', '15/12–15/1', [20, 35, 70, 25], 0.525, 0.30, 0.4, 0),
    T('pear', 'إجاص', 0.48, 0.98, 0.60, [30, 45, 40, 50], 0.75, 0.50, '03-01', '1 آذار'),
    T('peach', 'دراق', 0.49, 0.97, 0.59, [30, 50, 45, 40], 0.70, 0.50, '03-01', '1 آذار'),
    T('apricot', 'مشمش', 0.49, 0.94, 0.56, [30, 60, 30, 45], 0.70, 0.50, '03-01', '1 آذار'),
    T('apple', 'تفاح', 0.49, 0.94, 0.63, [30, 60, 60, 30], 0.75, 0.50, '03-15', '15 آذار'),
    T('olive', 'زيتون', 0.67, 0.81, 0.72, [65, 50, 60, 30], 0.90, 0.65, '03-01', '1 آذار'),
    T('grape', 'كرمة', 0.45, 1.08, 0.75, [35, 50, 60, 30], 0.90, 0.45, '03-15', '15 آذار'),
    T('pistachio', 'فستق حلبي', 0.44, 0.95, 0.49, [45, 45, 60, 25], 0.75, 0.40, '03-15', '15 آذار'),
    T('mandarin', 'حمضيات — يوسفي', 0.60, 1.20, 0.80, [40, 80, 75, 25], 0.75, 0.50, '02-15', '15 شباط'),
    T('citrus_local', 'حمضيات محلية', 0.55, 0.89, 0.80, [40, 80, 75, 25], 0.75, 0.50, '02-15', '15 شباط'),
    T('grapefruit', 'غريب فروت', 0.52, 1.10, 0.71, [40, 80, 75, 25], 0.75, 0.50, '02-15', '15 شباط'),
    T('navel', 'برتقال أبو صرة', 0.48, 1.10, 0.69, [40, 80, 75, 25], 0.75, 0.50, '02-15', '15 شباط'),
    T('meyer_lemon', 'حامض ماير', 0.51, 1.14, 0.87, [40, 80, 75, 25], 0.75, 0.50, '02-15', '15 شباط'),
    T('poplar', 'حور', 0.45, 1.00, 0.52, [35, 75, 75, 40], 0.90, 0.50, '03-01', '1 آذار'),
    T('almond', 'لوز', 0.50, 0.90, 0.65, [40, 40, 50, 30], 0.75, 0.40, '02-15', '15 شباط'),
    T('pomegranate', 'رمان', 0.50, 0.95, 0.65, [30, 65, 55, 35], 0.75, 0.50, '03-15', '15 آذار'),
    T('pine', 'صنوبر', 0.30, 0.67, 0.50, [30, 90, 90, 30], 0.90, 0.70, '03-01', '1 آذار'),
    T('date_palm', 'نخيل', 0.80, 0.98, 0.70, [33, 100, 33, 100], 0.90, 0.50, '03-01', '1 آذار')
  ];
  LOCAL.forEach(c => { CROPS[c.key] = c; });
  const GROUP_FAO = 'محاصيل FAO-56 بأطوار حرارية (معايرة سلمية)';
  ['wheat', 'barley', 'maize'].forEach(k => { CROPS[k].group = GROUP_FAO; });
  const GROUPS = [GROUP_FAO, W, S, F, M, V, 'الأشجار المثمرة'];

  /** Deep copy so UI edits never mutate the library */
  function get(key) { return JSON.parse(JSON.stringify(CROPS[key])); }

  G.Crops = { CROPS, get, keys: Object.keys(CROPS), GROUPS };
})(typeof window !== 'undefined' ? window : globalThis);
