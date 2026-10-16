/* GCSAR.Soils — soil water characteristics and irrigation system efficiencies.
 * Mirrors the future C# class  GCSAR.Irrigation.Core.SoilLibrary.
 * θFC, θWP [m³/m³]: mid-points of the ranges in FAO-56 Table 19 (replace with measured values when available).
 * CN: SCS curve number, antecedent condition II, cultivated land — indicative by hydrologic group.
 */
(function (root) {
  'use strict';
  const G = root.GCSAR = root.GCSAR || {};

  const SOILS = {
    sand:            { name: 'رملية',              thetaFC: 0.12,  thetaWP: 0.045, cn: 67 },
    loamySand:       { name: 'رملية لومية',        thetaFC: 0.15,  thetaWP: 0.065, cn: 72 },
    sandyLoam:       { name: 'لومية رملية',        thetaFC: 0.23,  thetaWP: 0.11,  cn: 75 },
    loam:            { name: 'لومية',              thetaFC: 0.25,  thetaWP: 0.12,  cn: 78 },
    siltLoam:        { name: 'لومية سلتية',        thetaFC: 0.29,  thetaWP: 0.15,  cn: 80 },
    silt:            { name: 'سلتية',              thetaFC: 0.32,  thetaWP: 0.17,  cn: 80 },
    siltyClayLoam:   { name: 'لومية طينية سلتية',  thetaFC: 0.335, thetaWP: 0.205, cn: 83 },
    siltyClay:       { name: 'طينية سلتية',        thetaFC: 0.36,  thetaWP: 0.23,  cn: 85 },
    clay:            { name: 'طينية',              thetaFC: 0.36,  thetaWP: 0.22,  cn: 85 }
  };

  // Typical application efficiencies Ea (fraction of applied water stored in the root zone)
  const SYSTEMS = {
    surface:   { name: 'ري سطحي (أثلام/أحواض)', ea: 0.60 },
    sprinkler: { name: 'ري بالرذاذ',             ea: 0.75 },
    drip:      { name: 'ري بالتنقيط',            ea: 0.90 }
  };

  /** Total available water in the root zone [mm] — FAO-56 Eq. 82 */
  const taw = (thetaFC, thetaWP, zr) => 1000 * (thetaFC - thetaWP) * zr;

  G.Soils = { SOILS, SYSTEMS, taw };
})(typeof window !== 'undefined' ? window : globalThis);
