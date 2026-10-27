/* Water balance screen — UI only. All science is in js/engine/*.js (GCSAR.WaterBalance etc.).
 * In the .NET version this file is replaced by a Blazor page; the field JSON format stays the same. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = () => window.GCSAR;
  const LS_KEY = 'gcsar.wb.field.v1', LS_ALERT = 'gcsar.wb.alert.v1';
  let FC = null;   // data/forecast/latest.json (Open-Meteo on the NASA grid)
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
  function fillSystem(key) { const y = E().Soils.SYSTEMS[key]; $('wbEa').value = y.ea; $('wbMaxNet').value = y.maxNetMm ?? ''; }
  const n = id => { const v = $(id).value; return v === '' ? null : +v; };

  function readField() {
    const key = $('wbCrop').value, base = E().Crops.get(key);
    return {
      schema: 'gcsar.field/1',
      name: $('wbName').value || 'حقل',
      areaDunum: n('wbArea'),
      location: { lat: +(state.station?.Latitude ?? NaN), lon: +(state.station?.Longitude ?? NaN), climateSource: state.sourceLabel || '' },
      sowingDate: $('wbSow').value, endDate: $('wbEnd').value, maturityDate: $('wbMaturity').value || null,
      crop: { ...base, kcIni: n('wbKcIni'), kcMid: n('wbKcMid'), kcEnd: n('wbKcEnd'), h: n('wbH'), zrMin: n('wbZrMin'), zrMax: n('wbZrMax'), p: n('wbP'),
        tbase: n('wbTbase'), tupper: n('wbTupper'), gdd: { iniEnd: n('wbG1'), devEnd: n('wbG2'), midEnd: n('wbG3'), lateEnd: n('wbG4') } },
      soil: { texture: $('wbSoil').value, thetaFC: n('wbFC'), thetaWP: n('wbWP'), cn: n('wbCN'),
        initialDepletionFrac: (n('wbDr0') ?? 50) / 100, subsoilDepletionFrac: (n('wbDsub0') ?? 50) / 100 },
      irrigation: { system: $('wbSystem').value, mode: $('wbMode').value, efficiency: n('wbEa'),
        triggerFrac: n('wbTrigger') === null ? null : n('wbTrigger') / 100, events: parseEvents($('wbEvents').value),
        maxNetMm: n('wbMaxNet'), forecastRainProbMin: n('wbRainProb') ?? 60, useForecast: $('wbUseFc').value === '1' },
      rain: { source: $('wbRainSrc').value, events: parseRain($('wbRain').value) }
    };
  }
  function writeField(f) {
    $('wbName').value = f.name || ''; $('wbArea').value = f.areaDunum ?? '';
    $('wbCrop').value = f.crop.key; fillCrop(f.crop.key);
    const c = f.crop;
    Object.entries({ wbKcIni: c.kcIni, wbKcMid: c.kcMid, wbKcEnd: c.kcEnd, wbH: c.h, wbZrMin: c.zrMin, wbZrMax: c.zrMax, wbP: c.p, wbTbase: c.tbase, wbTupper: c.tupper ?? '',
      wbG1: c.gdd.iniEnd, wbG2: c.gdd.devEnd, wbG3: c.gdd.midEnd, wbG4: c.gdd.lateEnd }).forEach(([k, v]) => $(k).value = v);
    $('wbSow').value = f.sowingDate || ''; $('wbEnd').value = f.endDate || ''; $('wbMaturity').value = f.maturityDate || '';
    $('wbSoil').value = f.soil.texture || 'loam'; $('wbFC').value = f.soil.thetaFC; $('wbWP').value = f.soil.thetaWP; $('wbCN').value = f.soil.cn;
    $('wbDr0').value = Math.round(100 * f.soil.initialDepletionFrac); $('wbDsub0').value = Math.round(100 * f.soil.subsoilDepletionFrac);
    $('wbSystem').value = f.irrigation.system || 'sprinkler'; $('wbMode').value = f.irrigation.mode; $('wbEa').value = f.irrigation.efficiency;
    $('wbTrigger').value = f.irrigation.triggerFrac === null ? '' : Math.round(100 * f.irrigation.triggerFrac);
    $('wbEvents').value = (f.irrigation.events || []).map(e => `${e.date}, ${e.grossMm}`).join('\n');
    $('wbMaxNet').value = f.irrigation.maxNetMm ?? (E().Soils.SYSTEMS[f.irrigation.system || 'sprinkler'].maxNetMm ?? '');
    $('wbRainSrc').value = f.rain?.source === 'listed' ? 'listed' : 'gauge'; $('wbRain').value = (f.rain?.events || []).map(e => `${e.date}, ${e.mm}`).join('\n'); rainInfo();
    $('wbRainProb').value = f.irrigation.forecastRainProbMin ?? 60; $('wbUseFc').value = f.irrigation.useForecast === false ? '0' : '1';
  }
  const qr = n => (n >= 3 && n <= 10) ? 'قراءات' : 'قراءة';
  /** measured rain lines "YYYY-MM-DD, mm" (also DD/MM/YYYY); later duplicates win */
  function parseRain(txt) {
    const m = new Map();
    txt.split(/\n/).forEach(l => { const r = parseRainLine(l); if (r) m.set(r.date, r.mm); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([date, mm]) => ({ date, mm }));
  }
  function parseRainLine(l) {
    l = String(l).trim(); let x = l.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*[,;\t ]\s*([\d.]+)/);
    if (x) return { date: `${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`, mm: +x[4] };
    x = l.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s*[,;\t ]\s*([\d.]+)/);
    return x ? { date: `${x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`, mm: +x[4] } : null;
  }
  function rainInfo() {
    const ev = parseRain($('wbRain').value), el = $('wbRainInfo');
    if (!ev.length) { el.textContent = 'لا قراءات — يُستخدم مطر ناسا.'; return; }
    const tot = ev.reduce((a, e) => a + e.mm, 0);
    el.innerHTML = `<b>${ev.length}</b> ${qr(ev.length)}، مجموعها <b>${tot.toFixed(1)}</b> مم، من ${ev[0].date} إلى ${ev[ev.length - 1].date}. ${$('wbRainSrc').value === 'gauge' ? 'ضمن هذه الفترة يحل المقياس محل ناسا كلياً (اليوم غير المدخل = بلا مطر)، وخارجها يبقى مطر ناسا.' : 'تُستبدل هذه الأيام فقط.'}`;
    $('wbRainBox').open = true;
  }
  /** Excel / CSV import: the first column that looks like a date and the first numeric column after it */
  async function importRain(file) {
    try {
      let rows;
      if (/\.csv$/i.test(file.name)) rows = (await file.text()).split(/\r?\n/).map(l => l.split(/[,;\t]/));
      else { const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }); }
      const out = [];
      for (const r of rows) {
        if (!r || r.length < 2) continue;
        let d = r[0], v = +String(r[1]).replace(',', '.');
        if (d instanceof Date) d = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        else if (typeof d === 'number' && d > 20000 && d < 80000) { const x = new Date(Date.UTC(1899, 11, 30) + d * 864e5); d = x.toISOString().slice(0, 10); }   // Excel serial date
        const p = parseRainLine(`${d}, ${v}`); if (p && Number.isFinite(v)) out.push(`${p.date}, ${p.mm}`);
      }
      if (!out.length) { toast('لم أجد عمودي التاريخ والمطر في الملف'); return; }
      $('wbRain').value = [$('wbRain').value.trim(), ...out].filter(Boolean).join('\n'); rainInfo(); toast(`استُوردت ${out.length} ${qr(out.length)} مطر`);
    } catch (e) { toast('تعذرت قراءة الملف'); }
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
  async function loadForecast() {
    if (FC) return FC;
    try { const base = archiveBase(); if (!base) return null; const r = await fetch(base.replace('data/nasa/', 'data/forecast/') + 'latest.json', { cache: 'no-cache' }); if (r.ok) FC = await r.json(); }
    catch (e) { FC = null; }
    return FC;
  }
  /** Days after the last approved day: Open-Meteo recent analysis ('model') then forecast, for the cell nearest the field.
   * ET0 is computed here with the same FAO-56 engine (RHmin/RHmax path). Returns {rows, note} or {rows:[], note}. */
  function forecastExtension(lastObs) {
    if (!FC) return { rows: [], note: 'التوقعات غير متاحة حالياً (تُحدَّث على الخادم مرتين يومياً).' };
    const lat = +state.station?.Latitude, lon = +state.station?.Longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { rows: [], note: 'لا توجد إحداثيات للموقع.' };
    const ci = nearestCell(FC.cells, lat, lon), cell = FC.cells[ci], V = FC.vars;
    const next = d => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return dateKey(x); };
    const start = next(lastObs), j0 = FC.dates.indexOf(start);
    if (j0 < 0) return { rows: [], note: start < FC.dates[0] ? `فجوة بين آخر يوم معتمد (${lastObs}) وبداية بيانات التوقع (${FC.dates[0]}): حدّث السلسلة المعتمدة من أرشيف المنصة.` : 'السلسلة المعتمدة تتجاوز فترة التوقع.' };
    const meta = { Latitude: lat, Elevation_m: +state.station?.Elevation_m || (cell[2] ?? 0), WindHeight_m: 2 };
    const rows = [];
    for (let j = j0; j < FC.dates.length; j++) {
      const d = FC.dates[j], rec = { Tmin_C: V.tmin[ci][j], Tmax_C: V.tmax[ci][j], RHmin_pct: V.rhmin[ci][j], RHmax_pct: V.rhmax[ci][j], WindSpeed_m_s: V.u2[ci][j], WindHeight_m: 2, SolarRadiation_MJ_m2_day: V.rs[ci][j] };
      const r = E().Fao56.et0FromRecord(rec, meta, new Date(d + 'T00:00:00'));
      rows.push({ date: d, tmin: rec.Tmin_C, tmax: rec.Tmax_C, et0: r.et0, rain: V.rain[ci][j] ?? 0, rainProb: V.rainProb[ci][j], u2: rec.WindSpeed_m_s, rhmin: rec.RHmin_pct,
        kind: d < FC.firstForecastDate ? 'model' : 'forecast' });
    }
    const nModel = rows.filter(r => r.kind === 'model').length;
    return { rows, note: `${nModel ? `${nModel} يوم من تحليل نموذج Open-Meteo لسدّ تأخر NASA، ثم ` : ''}${rows.length - nModel} أيام توقع (إصدار ${FC.issued.replace('T', ' ').replace('Z', ' UTC')}) لخلية ${cell[0]}°N, ${cell[1]}°E.` };
  }
  function notice() {
    const el = $('wbNotice'), w = weather();
    if (!state.rows.length) { el.innerHTML = '<span class="status warn">لا توجد بيانات مناخية</span> حمّل سلسلة من «أرشيف المنصة» أو ملف محطة في شاشة المناخ، ثم راجعها واعتمدها.'; return false; }
    if (!state.approved) { el.innerHTML = '<span class="status warn">البيانات غير معتمدة</span> لا تُحسب الموازنة إلا على سلسلة مناخية معتمدة (المعاينة البصرية + زر الاعتماد في شاشة المناخ).'; return false; }
    el.innerHTML = `<span class="status ok">مناخ معتمد</span> ${state.sourceLabel || state.station?.StationName || ''} — ${w.length} يوماً (${w[0]?.date} → ${w[w.length - 1]?.date}).`;
    return true;
  }

  // ---------- run
  async function runBalance() {
    if (!notice()) { toast('اعتمد البيانات المناخية أولاً'); return; }
    const f = readField(), obs = weather();
    if (!f.sowingDate || !f.endDate) { toast('حدد تاريخ الزراعة ونهاية المحاكاة'); return; }
    const first = obs[0].date, lastObs = obs[obs.length - 1].date;
    let w = obs, end = f.endDate > lastObs ? lastObs : f.endDate, fcNote = '';
    // forecast mode: the simulation runs to the end of the forecast when the chosen end date reaches the last approved day
    if (f.irrigation.useForecast && f.endDate >= lastObs) {
      await loadForecast();
      const ext = forecastExtension(lastObs); fcNote = ext.note;
      if (ext.rows.length) { w = obs.concat(ext.rows); end = ext.rows[ext.rows.length - 1].date; }
    } else if (f.sowingDate < first || f.endDate > lastObs) { toast(`المناخ المعتمد يغطي ${first} → ${lastObs} فقط`); }
    try {
      last = { field: f, fcNote, out: E().WaterBalance.run({ crop: f.crop, soil: f.soil, irrigation: f.irrigation, sowingDate: f.sowingDate < first ? first : f.sowingDate, endDate: end, maturityDate: f.maturityDate, rain: f.rain, weather: w }) };
    } catch (e) { toast(e.message); return; }
    persist();
    renderRec(); renderKpis(); renderCharts(); renderTable(); renderDashAlert(true);
    if (typeof syncCropFromField === 'function') { const lo = last.out.days.filter(d => d.Kind !== 'forecast').pop(); syncCropFromField(f.crop.key, f.sowingDate, lo && lo.Date, f.crop); } $('wbExportBtn').disabled = false;
  }

  const fmt = (v, d = 1) => v === null || v === undefined ? '—' : (+v).toFixed(d);
  const wd = d => new Date(d + 'T00:00:00').toLocaleDateString('ar-SY', { weekday: 'long' });
  const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  function headline() {
    const r = last.out.recommendation, t = r.today, a = r.alert, f = last.field, area = f.areaDunum || 0, ea = f.irrigation.efficiency;
    const vol = g => `${fmt(g)} مم = ${fmt(g)} م³/دونم${area ? ` (${fmt(g * area, 0)} م³ للحقل)` : ''}`;
    // a run whose last known day lies well in the past is an analysis of a past season, not an operational alert
    const ageDays = Math.round((Date.now() - new Date(t.date + 'T00:00:00')) / 864e5);
    if (ageDays > 14 && !(a && a.days)) {
      const sm = last.out.summary, ld = last.out.days.filter(d => d.Kind !== 'forecast').pop() || {};
      const harvested = t.action === 'harvested';
      return { level: 'history', html: `<div class="big wb-ok">تحليل موسم سابق</div><div>نهاية الفترة المحسوبة <b>${t.date}</b>، فلا يُصدر تنبيه ري لهذا التاريخ.<br>
        خلال الموسم: ${sm.irrigations} ${sm.irrigations >= 3 && sm.irrigations <= 10 ? 'ريات' : 'رية'}، الري الإجمالي <b>${vol(sm.Igross)}</b>، الهطول ${fmt(sm.P, 0)} مم، أيام الإجهاد المائي ${sm.stressDays}.${harvested ? `<br>${f.maturityDate ? 'النضج المرصود' : 'بلغ المحصول حد النضج'} في ${t.date}.` : `<br>لم يبلغ المحصول حد النضج حتى هذا التاريخ (GDD ${fmt(ld.GDD, 0)} من ${fmt(f.crop.gdd.lateEnd, 0)})؛ إن كان تاريخ النضج الفعلي معروفاً فأدخله في بطاقة الحقل.`}</div>` };
    }
    if (t.action === 'harvested') return { level: 'harvested', html: `<div class="big">انتهى الموسم</div><div>${last.field.maturityDate ? 'النضج المرصود' : 'بلغ التراكم الحراري حد النضج'} في <b>${t.date}</b>؛ لا توصيات ري بعد هذا التاريخ.</div>` };
    if (t.action === 'irrigate') return { level: 'now', html: `<div class="big wb-alert-now">ري الآن</div><div>آخر يوم معلوم <b>${t.date}</b>: العجز <b>${fmt(t.Dr)} مم</b> تجاوز العتبة ${fmt(t.trigger)} مم (TAW ${fmt(t.TAW, 0)} مم).<br>
      الرية: صافي <b>${fmt(t.netMm)} مم</b> — إجمالي عند Ea ${ea}: <b>${vol(t.grossMm)}</b>.${t.limited ? `<br>محدودة بأقصى عمق للنظام؛ يبقى عجز ${fmt(t.remainingMm)} مم تغطيه الرية التالية.` : ''}</div>` };
    if (a && a.level === 'soon') {
      const p0 = a.plan[0];
      return { level: 'soon', html: `<div class="big wb-alert-soon">ري متوقع ${wd(a.firstNeedDate)} ${dm(a.firstNeedDate)}</div><div>العجز يبلغ عتبة الري يوم <b>${a.firstNeedDate}</b> حسب التوقعات.${p0 ? `<br>الرية المقترحة <b>${p0.date}</b>: صافي ${fmt(p0.netMm)} مم — إجمالي <b>${vol(p0.grossMm)}</b>.` : ''}${a.plan.length > 1 ? `<br>${a.plan.length} ريات مقترحة خلال الفترة.` : ''}</div>` };
    }
    if (a) return { level: 'ok', html: `<div class="big wb-ok">لا حاجة للري حتى ${dm(a.to)}</div><div>العجز يبقى دون العتبة خلال أيام التوقع (${a.days} أيام).${t.daysUntil !== null ? `<br>بمعدل الاستهلاك الحالي ${fmt(t.rateMmDay, 2)} مم/يوم تُبلغ العتبة بعد نحو ${t.daysUntil} يوماً من ${t.date}.` : ''}</div>` };
    return { level: 'wait', html: `<div class="big wb-ok">لا حاجة للري</div><div>بتاريخ <b>${t.date}</b>: العجز <b>${fmt(t.Dr)} مم</b> من عتبة ${fmt(t.trigger)} مم.${t.daysUntil !== null ? `<br>الرية القادمة بعد نحو <b>${t.daysUntil} يوماً</b> بمعدل ${fmt(t.rateMmDay, 2)} مم/يوم (دون توقعات جوية).` : ''}</div>` };
  }
  function renderRec() {
    const el = $('wbRec'), r = last.out.recommendation;
    if (!r) { el.textContent = '—'; return; }
    const h = headline(), a = r.alert;
    let html = `<div class="wb-rec">${h.html}</div>`;
    if (a) {
      const fdays = last.out.days.filter(d => d.Kind === 'forecast');
      html += `<div class="wb-strip">${fdays.map(d => `<div class="wb-day${d.Inet > 0 ? ' irr' : d.NeedsIrrigation ? ' need' : ''}"><div class="wd">${wd(d.Date)}</div><b>${dm(d.Date)}</b><br>
        <span dir="ltr">ET₀ ${fmt(d.ET0, 1)} · ETc ${fmt(d.ETcAdj, 1)}</span><br>مطر ${fmt(d.RainForecast)} مم${d.RainProb !== null ? ` (${d.RainProb}%)` : ''}${d.RainForecast > 0 && d.P === 0 ? ' <span class="wb-badge">لم يُحتسب</span>' : ''}<br>
        العجز ${fmt(d.Dr, 0)} مم<br><span class="wd">العتبة ${fmt(d.Trigger, 0)} مم</span>${d.Inet > 0 ? `<br><b style="color:#c2410c">ري ${fmt(d.Igross, 0)} مم</b>` : ''}</div>`).join('')}</div>
        <div class="mini" style="margin-top:8px">مجموع الأيام ${a.days}: ET₀ ${fmt(a.et0Mm)} مم — مطر متوقع ${fmt(a.rainAllMm)} مم، المحتسب منه ${fmt(a.rainCountedMm)} مم (احتمال ≥ ${a.probMin}%).${a.harvestInHorizon ? ` بلوغ حد النضج متوقع ${a.harvestInHorizon}.` : ''}</div>`;
    }
    if (h.level !== 'history') html += `<div class="mini" style="margin-top:6px">${last.fcNote || 'التوصية على آخر يوم في السلسلة المعتمدة.'}</div>`;
    el.innerHTML = html;
  }
  /** Dashboard banner with the latest field alert (kept per browser so it shows on the next visit) */
  function renderDashAlert(fresh) {
    const box = $('dashAlert'); if (!box) return;
    let item = null;
    if (fresh && last) { const h = headline(); item = { name: last.field.name, level: h.level, html: h.html, at: new Date().toISOString().slice(0, 16).replace('T', ' ') }; try { localStorage.setItem(LS_ALERT, JSON.stringify(item)); } catch (e) { } }
    else { try { item = JSON.parse(localStorage.getItem(LS_ALERT) || 'null'); } catch (e) { } }
    if (!item) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3>تنبيه الري — ${item.name}</h3><span class="mini">آخر حساب ${item.at} — <a href="#" onclick="showSection('balance');return false">فتح الموازنة</a></span></div><div class="wb-rec">${item.html}</div>`;
  }
  function kpi(label, value, sub) { return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub || ''}</div></div>`; }
  function renderKpis() {
    const obsDays = last.out.days.filter(x => x.Kind !== 'forecast'), d = obsDays[obsDays.length - 1] || last.out.days[last.out.days.length - 1];
    // paired values carry their own labels (no "A / B" pairs: their order flips in RTL text)
    const pv = (l, v, u = '') => `<bdi class="pv"><small>${l}</small> ${v}${u ? ` <small>${u}</small>` : ''}</bdi>`;
    $('wbKpis').innerHTML = kpi('الطور (FAO-56)', d.StageName, `GDD ${fmt(d.GDD, 0)} °C·day`)
      + kpi('معامل المحصول وعمق الجذور', pv('Kc', fmt(d.Kc, 2)) + pv('Zr', fmt(d.Zr, 2), 'م'), `Kc mid معدّل مناخياً = ${fmt(last.out.kcMidAdj, 2)}`)
      + kpi('الماء المتاح في منطقة الجذور', pv('TAW', fmt(d.TAW, 0), 'مم') + pv('RAW', fmt(d.RAW, 0), 'مم'), `p معدّل = ${fmt(d.p, 2)}`)
      + kpi('الاستنزاف والإجهاد', pv('Dr', fmt(d.Dr, 0), 'مم') + pv('Ks', fmt(d.Ks, 2)), d.Ks < 1 ? 'إجهاد مائي' : 'دون إجهاد');
    const s = last.out.summary;
    $('wbSummary').innerHTML = kpi('الهطول والجريان', pv('P', fmt(s.P, 0), 'مم') + pv('RO', fmt(s.RO, 0), 'مم'), last.field.rain?.events?.length ? `مقياس الحقل (${last.field.rain.events.length} ${qr(last.field.rain.events.length)})${last.field.rain.source === 'listed' ? ' + ناسا لبقية الأيام' : ' + ناسا خارج فترة القراءات'}` : 'مطر NASA POWER الشبكي')
      + kpi('الري', pv('صافٍ', fmt(s.Inet, 0), 'مم') + pv('إجمالي', fmt(s.Igross, 0), 'مم'), `${s.irrigations} رية — ${fmt(s.Igross, 0)} م³/دونم`)
      + kpi('الاستهلاك المائي للمحصول', pv('ETc', fmt(s.ETc, 0), 'مم') + pv('ETc,adj', fmt(s.ETcAdj, 0), 'مم'), `ETc,adj/ETc = ${fmt(s.ETcAdjOverETc, 2)} — ${s.stressDays} يوم إجهاد`)
      + kpi('التسرب العميق DP', `${fmt(s.DP, 0)} مم`, `إغلاق التوازن ${fmt(s.MassClosureMm, 3)} مم`);
  }
  function renderTable() {
    const rows = last.out.days.slice().reverse().map(d => `<tr${d.Inet > 0 ? ' style="background:#fff4ec"' : ''}><td>${d.Date}${d.Kind === 'forecast' ? '<span class="wb-badge">توقع</span>' : d.Kind === 'model' ? '<span class="wb-badge">نموذج</span>' : ''}</td><td>${d.StageName}</td><td>${fmt(d.GDD, 0)}</td><td>${fmt(d.Kc, 2)}</td><td>${fmt(d.Zr, 2)}</td><td>${fmt(d.ET0, 2)}</td><td>${fmt(d.ETc, 2)}</td><td>${fmt(d.Ks, 2)}</td><td>${fmt(d.ETcAdj, 2)}</td><td>${fmt(d.P)}${d.RainSource === 'gauge' && d.P > 0 ? '<span class="wb-badge">مقيس</span>' : ''}</td><td>${fmt(d.RO)}</td><td>${fmt(d.Inet)}</td><td>${fmt(d.DP)}</td><td>${fmt(d.TAW, 0)}</td><td>${fmt(d.RAW, 0)}</td><td>${fmt(d.Dr)}</td></tr>`);
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
      // background bands: Open-Meteo analysis days and forecast days
      const band = (kind, fill, label) => { const ix = days.map((d, i) => d.Kind === kind ? i : -1).filter(i => i >= 0); if (!ix.length) return '';
        const x0 = x(ix[0]) - bw / 2, x1 = x(ix[ix.length - 1]) + bw / 2; return `<rect x="${x0}" y="${T}" width="${Math.max(2, x1 - x0)}" height="${ph}" fill="${fill}"/><text x="${(x0 + x1) / 2}" y="${T + 12}" text-anchor="middle" font-size="10" fill="#6b8086">${label}</text>`; };
      g += band('model', '#f1f4f5', 'نموذج') + band('forecast', '#e8eef0', 'توقع');
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
    $('wbRain').addEventListener('change', rainInfo); $('wbRainSrc').onchange = rainInfo; $('wbRainFile').onchange = e => e.target.files[0] && importRain(e.target.files[0]);
    $('wbRunBtn').onclick = runBalance; $('wbExportBtn').onclick = exportXlsx; $('wbSaveBtn').onclick = saveJson;
    $('wbLoadFile').onchange = e => e.target.files[0] && loadJson(e.target.files[0]);
    notice(); renderDashAlert(false);
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
