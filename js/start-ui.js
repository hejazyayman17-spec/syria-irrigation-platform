/* Start screen: pick a governorate → yesterday's ET0, today's weather, and a month calendar of daily ET0.
 * Source: data/forecast/latest.json (Open-Meteo, twice daily): 14 days of recent analysis + 8 forecast days per NASA cell.
 * ET0 is the platform's own FAO-56 Penman–Monteith (RHmin/RHmax path) on those inputs — not Open-Meteo's ET0.
 * Governorate value = mean over the NASA cells assigned to it (as the map does), else the cell nearest its centre.
 * Skill (tools/om_eval, 5 stations 2024–26): analysis and days 0–5 ahead ET0 bias −5…+7 %, RMSE 0.4–0.7 mm/d;
 * days 6–7 ahead +13…+26 % (wind too strong) → shown as a weak estimate with a wider band.
 */
(function () {
  'use strict';
  const LS = 'gcsar.start.gov', WEAK_FROM = 6, UNC_GOOD = 0.5, UNC_WEAK = 1.3;
  const $ = id => document.getElementById(id);
  let FC = null, gov = null, view = null, sel = null;
  try { gov = localStorage.getItem(LS); } catch (e) { }

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => iso(new Date());            // the viewer's local date (Syria: UTC+3, no DST)
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = (v, d = 1) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const WD = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];   // week starts on Saturday

  async function load() {
    if (FC) return FC;
    try {
      const base = archiveBase(); if (!base) return null;
      const r = await fetch(base.replace('data/nasa/', 'data/forecast/') + 'latest.json', { cache: 'no-cache' });
      if (r.ok) FC = await r.json();
    } catch (e) { FC = null; }
    return FC;
  }

  /** cells of one governorate (indices) */
  function cellsOf(k) {
    const own = FC.cells.map((c, i) => c[3] === k ? i : -1).filter(i => i >= 0);
    if (own.length) return own;
    const g = governorates[k]; return [nearestCell(FC.cells, g.lat, g.lon)];
  }
  /** daily values for the governorate: {date: {et0, tmax, tmin, rh, u2, rain, prob, kind, lead, weak, unc}} */
  function series(k) {
    const ix = cellsOf(k), out = {}, V = FC.vars;
    const mean = (v, j) => { const a = ix.map(i => V[v][i][j]).filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
    FC.dates.forEach((d, j) => {
      const isFc = d >= FC.firstForecastDate, lead = Math.round((new Date(d + 'T00:00:00') - new Date(FC.firstForecastDate + 'T00:00:00')) / 864e5);
      const rhx = mean('rhmax', j), rhn = mean('rhmin', j), probs = ix.map(i => V.rainProb[i][j]).filter(Number.isFinite);
      const weak = isFc && lead >= WEAK_FROM;
      out[d] = { et0: mean('et0', j), tmax: mean('tmax', j), tmin: mean('tmin', j), rh: rhx !== null && rhn !== null ? (rhx + rhn) / 2 : null,
        u2: mean('u2', j), rain: mean('rain', j), prob: probs.length ? Math.max(...probs) : null,
        kind: isFc ? 'forecast' : 'model', lead, weak, unc: weak ? UNC_WEAK : UNC_GOOD };
    });
    return { days: out, n: ix.length };
  }

  // ET0 colour: 0 → 8 mm/day on the platform's teal → amber → red scale
  function et0Color(v) {
    if (!Number.isFinite(v)) return '#eef3f4';
    const t = Math.max(0, Math.min(1, v / 8)), stops = [[0, [220, 239, 240]], [0.35, [120, 196, 199]], [0.6, [246, 196, 95]], [1, [214, 94, 60]]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
    const f = (t - a[0]) / ((b[0] - a[0]) || 1), c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * f));
    return `rgb(${c.join(',')})`;
  }

  function weatherRow(x, big) {
    const it = (ic, v, u, l) => `<div class="st-w"><span class="st-ic">${ic}</span><div><b>${v}</b><small>${u}</small><div class="st-l">${l}</div></div></div>`;
    if (!x) return '<div class="mini">لا بيانات لهذا اليوم</div>';
    return `<div class="st-wrow${big ? ' big' : ''}">${it('💧', fmt(x.rain), 'مم', `مطر${x.prob !== null && x.kind === 'forecast' ? ` · احتمال ${Math.round(x.prob)}%` : ''}`)}${it('🌬', fmt(x.u2), 'م/ث', 'رياح (2 م)')}${it('〰', fmt(x.rh, 0), '%', 'رطوبة نسبية')}${it('🌡', `<bdi>${fmt(x.tmax, 0)}°</bdi> <small>عظمى</small> <bdi>${fmt(x.tmin, 0)}°</bdi>`, 'صغرى', 'الحرارة')}</div>`;
  }

  function renderSide(S) {
    const t = todayIso(), y = addDays(t, -1), dy = S.days[y], dt = S.days[t];
    $('stSide').innerHTML = `
      <div class="st-h">أمس <small>${y.slice(8)}/${y.slice(5, 7)}</small></div>
      <div class="st-big"><span>ET₀</span> ${fmt(dy && dy.et0)} <small>مم/يوم</small></div>
      <div class="st-sub">${dy ? `≈ ${fmt(dy.et0)} م³ للدونم قبل معامل المحصول` : 'غير متاح'}</div>
      <div class="st-h" style="margin-top:22px">طقس اليوم</div>
      ${weatherRow(dt)}
      <div class="st-big sm"><span>ET₀ اليوم</span> ${fmt(dt && dt.et0)} <small>±${UNC_GOOD} مم</small></div>
      ${(() => { const nx = [1, 2, 3, 4, 5, 6, 7].map(i => S.days[addDays(t, i)]).filter(Boolean); if (!nx.length) return '';
        const sum = nx.reduce((a, x) => a + x.et0, 0), wet = nx.filter(x => x.prob >= 60 && x.rain >= 1).length;
        return `<div class="st-big sm"><span>الأيام القادمة (${nx.length})</span> ${fmt(sum, 0)} <small>مم ET₀</small></div><div class="st-sub">${wet ? `${wet} ${wet > 2 ? 'أيام' : 'يوم'} مطر مرجّح (احتمال 60% فأكثر)` : 'لا مطر مرجّح (احتمال 60% فأكثر)'}</div>`; })()}`;
  }

  function renderCal(S) {
    const [Y, M] = view.split('-').map(Number), first = new Date(Y, M - 1, 1), nd = new Date(Y, M, 0).getDate();
    const off = (first.getDay() + 1) % 7, t = todayIso();   // getDay: Sun=0 … Sat=6 → Saturday-first column
    let cells = '';
    for (let i = 0; i < off; i++) cells += '<div class="st-c empty"></div>';
    for (let d = 1; d <= nd; d++) {
      const k = `${Y}-${pad(M)}-${pad(d)}`, x = S.days[k];
      const cls = ['st-c', x ? 'has' : 'none', k === t ? 'today' : '', x && x.kind === 'forecast' ? 'fc' : '', x && x.weak ? 'weak' : '', k === sel ? 'sel' : ''].filter(Boolean).join(' ');
      cells += `<button class="${cls}" ${x ? `data-d="${k}" style="--c:${et0Color(x.et0)}"` : 'disabled'}><span class="n">${d}</span>${x ? `<span class="v">${x.weak ? '~' : ''}${fmt(x.et0)}</span>` : ''}</button>`;
    }
    const months = [...new Set(FC.dates.map(d => d.slice(0, 7)))], mi = months.indexOf(view);
    $('stCal').innerHTML = `
      <div class="st-mh"><button class="st-nav" data-m="${months[mi - 1] || ''}" ${mi > 0 ? '' : 'disabled'}>›</button><b>${MONTHS[M - 1]} ${Y}</b><button class="st-nav" data-m="${months[mi + 1] || ''}" ${mi >= 0 && mi < months.length - 1 ? '' : 'disabled'}>‹</button></div>
      <div class="st-grid">${WD.map(w => `<div class="st-wd">${w}</div>`).join('')}${cells}</div>
      <div class="st-legend"><span><i style="background:${et0Color(1)}"></i>1</span><span><i style="background:${et0Color(3)}"></i>3</span><span><i style="background:${et0Color(5)}"></i>5</span><span><i style="background:${et0Color(7)}"></i>7 مم/يوم</span>
        <span><i class="lg-today"></i>اليوم</span><span><i class="lg-fc"></i>توقع</span><span>~ تقدير ضعيف (اليوم 6–7)</span></div>`;
    $('stCal').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { sel = b.dataset.d; renderCal(S); renderDay(S); });
    $('stCal').querySelectorAll('.st-nav').forEach(b => b.onclick = () => { if (b.dataset.m) { view = b.dataset.m; renderCal(S); } });
  }

  function renderDay(S) {
    const x = S.days[sel], g = governorates[gov];
    const when = sel === todayIso() ? 'اليوم' : sel === addDays(todayIso(), -1) ? 'أمس' : `${sel.slice(8)}/${sel.slice(5, 7)}`;
    $('stDay').innerHTML = `<div class="st-dh">طقس ${when} في <b>${g.name}</b>${x ? ` — ${x.kind === 'forecast' ? (x.weak ? 'توقع بعيد (تقدير ضعيف)' : 'توقع') : 'تحليل نموذج Open-Meteo'}` : ''}</div>
      <div class="st-drow">${weatherRow(x, true)}<div class="st-et0"><small>ET₀</small><b>${fmt(x && x.et0)}</b><small>±${x ? x.unc : UNC_GOOD} مم/يوم</small></div></div>`;
  }

  async function render() {
    const box = $('stMain'); if (!box) return;
    if (!gov || !governorates[gov]) { box.hidden = true; $('stEmpty').hidden = false; return; }
    $('stEmpty').hidden = true;
    if (!await load()) { box.hidden = false; box.innerHTML = '<div class="card span12">تعذّر تحميل بيانات الطقس — تحقق من الاتصال ثم أعد المحاولة.</div>'; return; }
    box.hidden = false;
    const S = series(gov), t = todayIso();
    if (!view || !FC.dates.some(d => d.startsWith(view))) view = (FC.dates.includes(t) ? t : FC.dates[FC.dates.length - 1]).slice(0, 7);
    if (!sel || !S.days[sel]) sel = S.days[t] ? t : FC.dates[FC.dates.length - 1];
    renderSide(S); renderCal(S); renderDay(S);
    $('stSrc').textContent = `المصدر: Open-Meteo (تحليل آخر 14 يوماً وتوقع 8 أيام، إصدار ${FC.issued.replace('T', ' ').replace('Z', ' UTC')})، متوسط ${S.n} ${S.n > 2 ? 'خلايا' : S.n === 2 ? 'خليتين' : 'خلية'} شبكية. ET₀ وفق FAO-56 بنمان–مونتيث لسطح مرجعي (عشب)؛ احتياج المحصول = ET₀ × معامل المحصول.`;
  }

  function init() {
    const s = $('stGov'); if (!s) return;
    s.innerHTML = '<option value="">— اختر المحافظة —</option>' + Object.entries(governorates).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    if (gov && governorates[gov]) s.value = gov;
    s.onchange = () => { gov = s.value || null; sel = null; try { gov ? localStorage.setItem(LS, gov) : localStorage.removeItem(LS); } catch (e) { } render(); };
    $('stCalc').onclick = () => { showSection('climate'); const c = $('uploadCard'); if (c) setTimeout(() => c.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
    render();
  }
  window.STARTUI = { init, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
