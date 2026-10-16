/* Water balance screen — UI only. All science is in js/engine/*.js (GCSAR.WaterBalance etc.).
 * In the .NET version this file is replaced by a Blazor page; the field JSON format stays the same. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = () => window.GCSAR;
  const LS_KEY = 'gcsar.wb.field.v1';
  const COL = { rain: '#3a7fc1', irr: '#c2410c', dr: '#008c99', trig: '#b7791f', taw: '#5f7a80' };
  let last = null;

  // ---------- form <-> Field JSON (same schema the C# FieldDefinition will serialize)
  function fillCrop(key) {
    const c = E().Crops.get(key);
    $('wbKcIni').value = c.kcIni; $('wbKcMid').value = c.kcMid; $('wbKcEnd').value = c.kcEnd; $('wbH').value = c.h;
    $('wbZrMin').value = c.zrMin; $('wbZrMax').value = c.zrMax; $('wbP').value = c.p;
    $('wbTbase').value = c.tbase; $('wbTupper').value = c.tupper ?? '';
    $('wbG1').value = c.gdd.iniEnd; $('wbG2').value = c.gdd.devEnd; $('wbG3').value = c.gdd.midEnd; $('wbG4').value = c.gdd.lateEnd;
    $('wbCropNote').textContent = c.note || '';
  }
  function fillSoil(key) { const s = E().Soils.SOILS[key]; $('wbFC').value = s.thetaFC; $('wbWP').value = s.thetaWP; $('wbCN').value = s.cn; }
  function fillSystem(key) { $('wbEa').value = E().Soils.SYSTEMS[key].ea; }
  const n = id => { const v = $(id).value; return v === '' ? null : +v; };

  function readField() {
    const key = $('wbCrop').value, base = E().Crops.get(key);
    return {
      schema: 'gcsar.field/1',
      name: $('wbName').value || 'حقل',
      areaDunum: n('wbArea'),
      location: { lat: +(state.station?.Latitude ?? NaN), lon: +(state.station?.Longitude ?? NaN), climateSource: state.sourceLabel || '' },
      sowingDate: $('wbSow').value, endDate: $('wbEnd').value,
      crop: { ...base, kcIni: n('wbKcIni'), kcMid: n('wbKcMid'), kcEnd: n('wbKcEnd'), h: n('wbH'), zrMin: n('wbZrMin'), zrMax: n('wbZrMax'), p: n('wbP'),
        tbase: n('wbTbase'), tupper: n('wbTupper'), gdd: { iniEnd: n('wbG1'), devEnd: n('wbG2'), midEnd: n('wbG3'), lateEnd: n('wbG4') } },
      soil: { texture: $('wbSoil').value, thetaFC: n('wbFC'), thetaWP: n('wbWP'), cn: n('wbCN'),
        initialDepletionFrac: (n('wbDr0') ?? 50) / 100, subsoilDepletionFrac: (n('wbDsub0') ?? 50) / 100 },
      irrigation: { system: $('wbSystem').value, mode: $('wbMode').value, efficiency: n('wbEa'),
        triggerFrac: n('wbTrigger') === null ? null : n('wbTrigger') / 100, events: parseEvents($('wbEvents').value) }
    };
  }
  function writeField(f) {
    $('wbName').value = f.name || ''; $('wbArea').value = f.areaDunum ?? '';
    $('wbCrop').value = f.crop.key; fillCrop(f.crop.key);
    const c = f.crop;
    Object.entries({ wbKcIni: c.kcIni, wbKcMid: c.kcMid, wbKcEnd: c.kcEnd, wbH: c.h, wbZrMin: c.zrMin, wbZrMax: c.zrMax, wbP: c.p, wbTbase: c.tbase, wbTupper: c.tupper ?? '',
      wbG1: c.gdd.iniEnd, wbG2: c.gdd.devEnd, wbG3: c.gdd.midEnd, wbG4: c.gdd.lateEnd }).forEach(([k, v]) => $(k).value = v);
    $('wbSow').value = f.sowingDate || ''; $('wbEnd').value = f.endDate || '';
    $('wbSoil').value = f.soil.texture || 'loam'; $('wbFC').value = f.soil.thetaFC; $('wbWP').value = f.soil.thetaWP; $('wbCN').value = f.soil.cn;
    $('wbDr0').value = Math.round(100 * f.soil.initialDepletionFrac); $('wbDsub0').value = Math.round(100 * f.soil.subsoilDepletionFrac);
    $('wbSystem').value = f.irrigation.system || 'sprinkler'; $('wbMode').value = f.irrigation.mode; $('wbEa').value = f.irrigation.efficiency;
    $('wbTrigger').value = f.irrigation.triggerFrac === null ? '' : Math.round(100 * f.irrigation.triggerFrac);
    $('wbEvents').value = (f.irrigation.events || []).map(e => `${e.date}, ${e.grossMm}`).join('\n');
  }
  function parseEvents(txt) {
    return txt.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/(\d{4}-\d{2}-\d{2})\s*[,;\t ]\s*([\d.]+)/); return m ? { date: m[1], grossMm: +m[2] } : null; }).filter(Boolean);
  }
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(readField())); } catch (e) { } };

  // ---------- climate from the approved series
  function weather() {
    return (state.rows || []).filter(r => r._date && Number.isFinite(r._et0)).map(r => ({
      date: dateKey(r._date), tmin: num(r.Tmin_C), tmax: num(r.Tmax_C), et0: r._et0, rain: num(r.Rain_mm) ?? 0,
      u2: r._res && Number.isFinite(r._res.u2) ? r._res.u2 : null, rhmin: E().Fao56.rhMin(r)
    }));
  }
  function notice() {
    const el = $('wbNotice'), w = weather();
    if (!state.rows.length) { el.innerHTML = '<span class="status warn">لا توجد بيانات مناخية</span> حمّل سلسلة من «أرشيف المنصة» أو ملف محطة في شاشة المناخ، ثم راجعها واعتمدها.'; return false; }
    if (!state.approved) { el.innerHTML = '<span class="status warn">البيانات غير معتمدة</span> لا تُحسب الموازنة إلا على سلسلة مناخية معتمدة (المعاينة البصرية + زر الاعتماد في شاشة المناخ).'; return false; }
    el.innerHTML = `<span class="status ok">مناخ معتمد</span> ${state.sourceLabel || state.station?.StationName || ''} — ${w.length} يوماً (${w[0]?.date} → ${w[w.length - 1]?.date}).`;
    return true;
  }

  // ---------- run
  function runBalance() {
    if (!notice()) { toast('اعتمد البيانات المناخية أولاً'); return; }
    const f = readField(), w = weather();
    if (!f.sowingDate || !f.endDate) { toast('حدد تاريخ الزراعة ونهاية المحاكاة'); return; }
    const first = w[0].date, lastD = w[w.length - 1].date;
    if (f.sowingDate < first || f.endDate > lastD) { toast(`المناخ المعتمد يغطي ${first} → ${lastD} فقط`); }
    const end = f.endDate > lastD ? lastD : f.endDate;
    try {
      last = { field: f, out: E().WaterBalance.run({ crop: f.crop, soil: f.soil, irrigation: f.irrigation, sowingDate: f.sowingDate < first ? first : f.sowingDate, endDate: end, weather: w }) };
    } catch (e) { toast(e.message); return; }
    persist();
    renderRec(); renderKpis(); renderCharts(); renderTable(); $('wbExportBtn').disabled = false;
  }

  const fmt = (v, d = 1) => v === null || v === undefined ? '—' : (+v).toFixed(d);
  function renderRec() {
    const r = last.out.recommendation, s = last.out.summary, area = last.field.areaDunum || 0, el = $('wbRec');
    if (!r) { el.textContent = '—'; return; }
    if (r.action === 'harvested') { el.innerHTML = `<div class="wb-rec"><div class="big">انتهى الموسم</div><div>بلغ التراكم الحراري حد النضج (الحصاد) في <b>${r.date}</b>؛ لا توصيات ري بعد هذا التاريخ.</div></div>`; return; }
    if (r.action === 'irrigate') {
      el.innerHTML = `<div class="wb-rec"><div class="big wb-go">ري الآن</div><div>بتاريخ <b>${r.date}</b>: العجز <b>${fmt(r.Dr)} مم</b> تجاوز العتبة (${fmt(r.trigger)} مم من TAW = ${fmt(r.TAW)} مم).<br>
        الكمية الصافية <b>${fmt(r.netMm)} مم</b> — الإجمالية عند الكفاءة ${last.field.irrigation.efficiency}: <b>${fmt(r.grossMm)} مم = ${fmt(r.m3PerDunum)} م³/دونم</b>${area ? ` — <b>${fmt(r.m3PerDunum * area, 0)} م³</b> للحقل (${area} دونم)` : ''}.</div></div>`;
    } else {
      el.innerHTML = `<div class="wb-rec"><div class="big wb-ok">لا حاجة للري</div><div>بتاريخ <b>${r.date}</b>: العجز <b>${fmt(r.Dr)} مم</b> من عتبة ${fmt(r.trigger)} مم.<br>
        ${r.daysUntil === null ? 'لا يمكن تقدير موعد الرية القادمة (استهلاك قريب من الصفر).' : `الرية القادمة متوقعة بعد نحو <b>${r.daysUntil} يوماً</b> بمعدل استهلاك ${fmt(r.rateMmDay, 2)} مم/يوم (متوسط آخر 7 أيام، دون احتساب أمطار قادمة).`}</div></div>`;
    }
    el.innerHTML += `<div class="mini" style="margin-top:8px">التوصية على آخر يوم متاح في السلسلة المناخية. بيانات NASA POWER تتأخر عدة أيام؛ التنبؤ الجوي سيُضاف في مرحلة لاحقة.</div>`;
  }
  function kpi(label, value, sub) { return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub || ''}</div></div>`; }
  function renderKpis() {
    const d = last.out.days[last.out.days.length - 1];
    $('wbKpis').innerHTML = kpi('الطور (FAO-56)', d.StageName, `GDD ${fmt(d.GDD, 0)} °C·day`) + kpi('Kc / عمق الجذور', `${fmt(d.Kc, 2)} / ${fmt(d.Zr, 2)} م`, `Kc mid معدّل مناخياً = ${fmt(last.out.kcMidAdj, 2)}`)
      + kpi('TAW / RAW', `${fmt(d.TAW, 0)} / ${fmt(d.RAW, 0)} مم`, `p معدّل = ${fmt(d.p, 2)}`) + kpi('Dr / Ks', `${fmt(d.Dr, 0)} مم / ${fmt(d.Ks, 2)}`, d.Ks < 1 ? 'إجهاد مائي' : 'دون إجهاد');
    const s = last.out.summary;
    $('wbSummary').innerHTML = kpi('الهطول P / الجريان RO', `${fmt(s.P, 0)} / ${fmt(s.RO, 0)} مم`) + kpi('الري الصافي / الإجمالي', `${fmt(s.Inet, 0)} / ${fmt(s.Igross, 0)} مم`, `${s.irrigations} رية — ${fmt(s.Igross, 0)} م³/دونم`)
      + kpi('ETc / ETc,adj', `${fmt(s.ETc, 0)} / ${fmt(s.ETcAdj, 0)} مم`, `النسبة ${fmt(s.ETcAdjOverETc, 2)} — ${s.stressDays} يوم إجهاد`)
      + kpi('التسرب العميق DP', `${fmt(s.DP, 0)} مم`, s.YieldReductionPct === null ? `إغلاق التوازن ${fmt(s.MassClosureMm, 3)} مم` : `نقص غلة تقديري ${fmt(s.YieldReductionPct, 0)}% (Ky) — إغلاق ${fmt(s.MassClosureMm, 3)} مم`);
  }
  function renderTable() {
    const rows = last.out.days.slice().reverse().map(d => `<tr${d.Inet > 0 ? ' style="background:#fff4ec"' : ''}><td>${d.Date}</td><td>${d.StageName}</td><td>${fmt(d.GDD, 0)}</td><td>${fmt(d.Kc, 2)}</td><td>${fmt(d.Zr, 2)}</td><td>${fmt(d.ET0, 2)}</td><td>${fmt(d.ETc, 2)}</td><td>${fmt(d.Ks, 2)}</td><td>${fmt(d.ETcAdj, 2)}</td><td>${fmt(d.P)}</td><td>${fmt(d.RO)}</td><td>${fmt(d.Inet)}</td><td>${fmt(d.DP)}</td><td>${fmt(d.TAW, 0)}</td><td>${fmt(d.RAW, 0)}</td><td>${fmt(d.Dr)}</td></tr>`);
    $('wbTable').querySelector('tbody').innerHTML = rows.join('');
  }

  // ---------- charts (single y-axis each; same x; shared hover)
  const W = 1100, L = 64, R = 20;
  function xScale(days) { const n = Math.max(1, days.length - 1); return i => L + i / n * (W - L - R); }
  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / p) * p; }
  function renderCharts() {
    const days = last.out.days, x = xScale(days), bw = Math.max(1.5, (W - L - R) / days.length - 1);
    // top: rain and irrigation bars (mm/day)
    { const H = 150, T = 14, B = 22, ph = H - T - B, mx = niceMax(Math.max(10, ...days.map(d => Math.max(d.P, d.Igross)))), y = v => T + ph - v / mx * ph;
      let g = `<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="#cfdde0"/>`;
      [0, mx / 2, mx].forEach(t => g += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="#eef3f4"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#6b8086">${t}</text>`);
      days.forEach((d, i) => {
        if (d.P > 0) g += `<rect x="${x(i) - bw / 2}" y="${y(d.P)}" width="${bw}" height="${T + ph - y(d.P)}" rx="1" fill="${COL.rain}"/>`;
        if (d.Igross > 0) g += `<rect x="${x(i) - bw / 2 - 1}" y="${y(d.Igross)}" width="${bw + 2}" height="${T + ph - y(d.Igross)}" rx="1" fill="${COL.irr}" stroke="#fff" stroke-width="1"/>`;
      });
      $('wbChartTop').innerHTML = g + `<line id="wbCrossTop" y1="${T}" y2="${T + ph}" stroke="#9fb3b8" stroke-width="1" visibility="hidden"/>`;
      $('wbLegendTop').innerHTML = `<span><i style="background:${COL.rain};border-color:${COL.rain};border-radius:2px"></i>الهطول P</span><span><i style="background:${COL.irr};border-color:${COL.irr};border-radius:2px"></i>الري الإجمالي</span>`;
    }
    // bottom: depletion Dr (0 = field capacity at top, increasing downward), RAW/trigger and TAW
    { const H = 360, T = 18, B = 40, ph = H - T - B, mx = niceMax(Math.max(...days.map(d => d.TAW))), y = v => T + v / mx * ph;
      let g = '';
      for (let k = 0; k <= 4; k++) { const t = mx * k / 4; g += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="#eef3f4"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#6b8086">${t.toFixed(0)}</text>`; }
      const path = f => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(d)).toFixed(1)}`).join('');
      // stress zone shading between trigger and TAW
      g += `<path d="${path(d => d.Trigger)}${days.map((d, i) => `L${x(days.length - 1 - i).toFixed(1)},${y(days[days.length - 1 - i].TAW).toFixed(1)}`).join('')}Z" fill="${COL.trig}" fill-opacity=".08"/>`;
      g += `<path d="${path(d => d.TAW)}" fill="none" stroke="${COL.taw}" stroke-width="1.5"/>`;
      g += `<path d="${path(d => d.Trigger)}" fill="none" stroke="${COL.trig}" stroke-width="2" stroke-dasharray="6 4"/>`;
      g += `<path d="${path(d => d.Dr)}" fill="none" stroke="${COL.dr}" stroke-width="2.2" stroke-linejoin="round"/>`;
      const e = days.length - 1;
      g += `<text x="${x(e) - 4}" y="${y(days[e].TAW) - 6}" text-anchor="end" font-size="11" fill="#4b6066">TAW</text><text x="${x(e) - 4}" y="${y(days[e].Trigger) - 6}" text-anchor="end" font-size="11" fill="#4b6066">عتبة الري</text>`;
      // month ticks
      days.forEach((d, i) => { if (d.Date.endsWith('-01')) g += `<line x1="${x(i)}" y1="${T + ph}" x2="${x(i)}" y2="${T + ph + 5}" stroke="#9fb3b8"/><text x="${x(i)}" y="${T + ph + 18}" text-anchor="middle" font-size="11" fill="#6b8086">${d.Date.slice(0, 7)}</text>`; });
      g += `<line id="wbCross" y1="${T}" y2="${T + ph}" stroke="#9fb3b8" stroke-width="1" visibility="hidden"/><circle id="wbDot" r="5" fill="${COL.dr}" stroke="#fff" stroke-width="2" visibility="hidden"/>`;
      g += `<rect id="wbHit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>`;
      $('wbChart').innerHTML = g;
      $('wbLegend').innerHTML = `<span><i class="legend-line" style="background:${COL.dr}"></i>العجز Dr</span><span><i class="legend-line" style="background:${COL.trig}"></i>عتبة الري (RAW)</span><span><i class="legend-line" style="background:${COL.taw}"></i>TAW</span>`;
      hover(days, x, y);
    }
  }
  function hover(days, x, y) {
    const svg = $('wbChart'), hit = $('wbHit'), tip = $('wbTip');
    const move = ev => {
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(days.length - 1, Math.round((vx - L) / (W - L - R) * (days.length - 1)))), d = days[i], px = x(i);
      ['wbCross', 'wbCrossTop'].forEach(id => { const l = $(id); l.setAttribute('x1', px); l.setAttribute('x2', px); l.setAttribute('visibility', 'visible'); });
      const dot = $('wbDot'); dot.setAttribute('cx', px); dot.setAttribute('cy', y(d.Dr)); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${d.Date}</b> — ${d.StageName}<br>Dr <b>${fmt(d.Dr)}</b> مم · العتبة ${fmt(d.Trigger)} · TAW ${fmt(d.TAW, 0)}<br>Ks <b>${fmt(d.Ks, 2)}</b> · ETc,adj ${fmt(d.ETcAdj, 2)} مم<br>P ${fmt(d.P)} · ري ${fmt(d.Igross)} مم${d.AutoIrrigation ? ' (تلقائي)' : ''}`;
      const left = px / W * r.width; tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12) + 'px';
    };
    hit.onmousemove = move; hit.ontouchstart = e => move(e.touches[0]); hit.ontouchmove = e => move(e.touches[0]);
    hit.onmouseleave = () => { tip.hidden = true; ['wbCross', 'wbCrossTop', 'wbDot'].forEach(id => $(id).setAttribute('visibility', 'hidden')); };
  }

  // ---------- export / save / load
  function exportXlsx() {
    if (!last || !window.XLSX) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(last.out.days), 'DailyBalance');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(last.out.summary).map(([k, v]) => ({ Item: k, Value: v }))), 'Summary');
    const f = last.field;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Field: f.name, Crop: f.crop.key, Sowing: f.sowingDate, End: f.endDate, ThetaFC: f.soil.thetaFC, ThetaWP: f.soil.thetaWP, CN: f.soil.cn, Mode: f.irrigation.mode, Ea: f.irrigation.efficiency, Climate: f.location.climateSource, Engine: 'FAO-56 single Kc, GCSAR v0.7' }]), 'Field');
    XLSX.writeFile(wb, `WaterBalance_${(f.name || 'field').replace(/\s+/g, '_')}_${f.sowingDate}.xlsx`);
  }
  function saveJson() {
    const blob = new Blob([JSON.stringify(readField(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `field_${($('wbName').value || 'field').replace(/\s+/g, '_')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function loadJson(file) {
    try { const f = JSON.parse(await file.text()); if (f.schema !== 'gcsar.field/1') throw new Error('ليس ملف حقل للمنصة'); writeField(f); persist(); toast('تم فتح الحقل'); }
    catch (e) { toast('تعذر فتح الملف: ' + e.message); }
  }

  // ---------- init
  function init() {
    const C = E().Crops, S = E().Soils;
    $('wbCrop').innerHTML = C.keys.map(k => `<option value="${k}">${C.CROPS[k].name}</option>`).join('');
    $('wbSoil').innerHTML = Object.entries(S.SOILS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
    $('wbSystem').innerHTML = Object.entries(S.SYSTEMS).map(([k, s]) => `<option value="${k}">${s.name} (Ea ${s.ea})</option>`).join('');
    $('wbCrop').value = 'wheat'; fillCrop('wheat'); $('wbSoil').value = 'siltLoam'; fillSoil('siltLoam'); $('wbSystem').value = 'sprinkler'; fillSystem('sprinkler');
    let saved = null; try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { }
    if (saved && saved.schema === 'gcsar.field/1') writeField(saved);
    $('wbCrop').onchange = e => { fillCrop(e.target.value); defaultDates(true); };
    $('wbSoil').onchange = e => fillSoil(e.target.value);
    $('wbSystem').onchange = e => fillSystem(e.target.value);
    $('wbRunBtn').onclick = runBalance; $('wbExportBtn').onclick = exportXlsx; $('wbSaveBtn').onclick = saveJson;
    $('wbLoadFile').onchange = e => e.target.files[0] && loadJson(e.target.files[0]);
    notice();
  }
  /** Typical sowing date of the crop's most recent season that has started before `ref` (YYYY-MM-DD) */
  function typicalSow(key, ref) {
    const md = E().Crops.CROPS[key].sowMonthDay || '11-20', y = +ref.slice(0, 4);
    return `${y}-${md}` <= ref ? `${y}-${md}` : `${y - 1}-${md}`;
  }
  function defaultDates(force) {
    const w = weather(), lastD = w.length ? w[w.length - 1].date : dateKey(new Date());
    if (force || !$('wbSow').value) $('wbSow').value = typicalSow($('wbCrop').value, lastD);
    if (force || !$('wbEnd').value) $('wbEnd').value = lastD;
  }
  function onShow() { notice(); defaultDates(false); }
  window.WB = { init, onShow, run: runBalance, get last() { return last; }, readField, writeField };
})();
