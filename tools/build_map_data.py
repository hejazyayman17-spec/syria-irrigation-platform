"""Build compact governorate geometry (lon/lat) for the browser map.

Source: geoBoundaries gbOpen SYR ADM1 (CC BY 4.0), WGS84.
coverage_simplify keeps shared borders identical between neighbours (no gaps/overlaps).
Output: data/syria_gov.js  ->  const SYRIA_GOV = {key:{rings:[[[lon,lat],...],...], label:[lon,lat]}}
"""
import json, sys
import shapely
from shapely.geometry import shape, mapping
from shapely.ops import polylabel

SRC, OUT = sys.argv[1], sys.argv[2]
TOL = 0.004  # degrees (~400 m) — invisible at national scale, cuts size ~4x

KEYS = {'Damascus': 'damascus', 'Rural Damascus': 'rif-dimashq', 'Aleppo': 'aleppo', 'Idleb': 'idlib',
        'Hama': 'hama', 'Homs': 'homs', 'Lattakia': 'latakia', 'Tartous': 'tartus', "Dar'a": 'daraa',
        'As-Sweida': 'suwayda', 'Quneitra': 'quneitra', 'Ar-Raqqa': 'raqqa', 'Deir-ez-Zor': 'deir-ez-zor',
        'Al-Hasakeh': 'hasakah'}

fc = json.load(open(SRC, encoding='utf8'))
names = [f['properties']['shapeName'] for f in fc['features']]
geoms = [shape(f['geometry']).buffer(0) for f in fc['features']]
simp = shapely.coverage_simplify(geoms, TOL)

out, nv = {}, 0
for name, g in zip(names, simp):
    polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
    polys = [p for p in polys if p.area > 1e-5]          # drop slivers
    rings = [[[round(x, 3), round(y, 3)] for x, y in p.exterior.coords] for p in polys]
    nv += sum(len(r) for r in rings)
    big = max(polys, key=lambda p: p.area)
    lp = polylabel(big, tolerance=0.01)                    # pole of inaccessibility = best label spot
    out[KEYS[name]] = {'rings': rings, 'label': [round(lp.x, 3), round(lp.y, 3)]}

# national outline = union of the simplified coverage (exact same edges as governorates)
u = shapely.union_all(simp)
upolys = list(u.geoms) if u.geom_type == 'MultiPolygon' else [u]
outline = [[[round(x, 3), round(y, 3)] for x, y in p.exterior.coords] for p in upolys if p.area > 1e-5]

with open(OUT, 'w', encoding='utf8') as f:
    f.write('// Syria ADM1 — geoBoundaries gbOpen (CC BY 4.0), simplified (coverage, tol=%s°)\n' % TOL)
    f.write('const SYRIA_GOV=' + json.dumps(out, separators=(',', ':')) + ';\n')
    f.write('const SYRIA_OUTLINE=' + json.dumps(outline, separators=(',', ':')) + ';\n')
print('governorates', len(out), 'vertices', nv)
