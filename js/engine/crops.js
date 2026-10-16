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
      key: 'wheat', name: 'قمح (شتوي)',
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
      key: 'barley', name: 'شعير',
      kcIni: 0.70, kcMid: 1.15, kcEnd: 0.25, h: 1.0,
      zrMin: 0.20, zrMax: 1.20, p: 0.55, ky: null,
      tbase: 0, tupper: null,
      gdd: { iniEnd: 500, devEnd: 1450, midEnd: 1900, lateEnd: 2350 },   // ≈ two weeks earlier than wheat
      note: 'Kc ini مأخوذ مثل القمح الشتوي لنظام الأمطار الشتوية؛ حدود الأطوار أبكر من القمح بنحو أسبوعين. تُعاير محلياً.'
    },
    maize: {
      key: 'maize', name: 'ذرة صفراء (حبية)',
      kcIni: 0.30, kcMid: 1.20, kcEnd: 0.35, h: 2.0,
      zrMin: 0.20, zrMax: 1.30, p: 0.55, ky: 1.25,
      tbase: 10, tupper: 30,
      gdd: { iniEnd: 200, devEnd: 750, midEnd: 1300, lateEnd: 1800 },
      note: 'Kc end = 0.35 للحصاد الجاف للحبوب (0.60 للحصاد الرطب).'
    }
  };

  /** Deep copy so UI edits never mutate the library */
  function get(key) { return JSON.parse(JSON.stringify(CROPS[key])); }

  G.Crops = { CROPS, get, keys: Object.keys(CROPS) };
})(typeof window !== 'undefined' ? window : globalThis);
