/* Reports — seasonal crop water requirement for one crop and sowing date:
 *   temporal variation : one site, several seasons (years of the platform archive)
 *   spatial variation  : one season, several sites
 * Every row is a full run of the same engine as the field card (FAO-56 single Kc, scheduled irrigation at RAW,
 * the chosen system's Ea and max net depth), on NASA POWER from the archive, corrected locally when the correction
 * is on (same settings as the climate screen). No new science here: only orchestration, statistics and display. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = () => window.GCSAR;
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const YEARS = new Map();          // archive year → promise of the JSON (cached for the session)
  let LAST = null, LASTDATE = null, ARCHIVE_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
  const f = (v, d = 0) => Number.isFinite(v) ? (+v).toFixed(d) : '—';
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const addDays = (s, n) => { const x = new Date(s + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  function sites() {
    const out = [];
    Object.entries(ecoRegions).forEach(([k, v]) => out.push({ key: 'eco:' + k, name: v.name, lat: v.lat, lon: v.lon, group: 'مناطق زراعية' }));
    Object.entries(governorates).forEach(([k, v]) => out.push({ key: 'gov:' + k, name: v.name, lat: v.lat, lon: v.lon, group: 'مراكز المحافظات' }));
    return out;
  }
  function customSites() {
    return $('rpCustom').value.split(/\n/).map(l => l.trim()).filter(Boolean).map((l, i) => {
      const p = l.split(/[,،;\t]/).map(x => x.trim());
      const lat = +p[1], lon = +p[2], elev = p[3] === undefined || p[3] === '' ? null : +p[3];
      return Number.isFinite(lat) && Number.isFinite(lon) ? { key: 'cus:' + i, name: p[0] || `موقع ${i + 1}`, lat, lon, elev: Number.isFinite(elev) ? elev : null } : null;
    }).filter(Boolean);
  }

  async function year(y) {
    if (!YEARS.has(y)) YEARS.set(y, archiveJson(`${y}.json`).catch(e => { YEARS.delete(y); throw e; }));
    return YEARS.get(y);
  }

  /** daily weather for one site between two dates, NASA archive → (corrected) ET0, in the engine's input form */
  async function weather(site, from, to) {
    const out = []; let cellInfo = null;
    const C = window.CORRUI, cfg = C && C.cfg, eng = C && C.engine, useCorr = !!(eng && cfg && cfg.on);
    let corrSite = null, res = null;
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      let a; try { a = await year(y); } catch (e) { continue; }
      const ci = nearestCell(a.cells, site.lat, site.lon), cell = a.cells[ci]; cellInfo = cell;
      const elev = Number.isFinite(site.elev) ? site.elev : (cell[2] ?? 0);
      if (useCorr && !corrSite) { corrSite = { lat: site.lat, lon: site.lon, elevationM: elev, siteType: cfg.siteType, measuredWindFactor: Number.isFinite(cfg.windFactor) ? cfg.windFactor : null }; res = eng.resolve(corrSite); }
      const V = p => a.vars[p][ci];
      const tx = V('T2M_MAX'), tn = V('T2M_MIN'), td = V('T2MDEW'), rh = V('RH2M'), ws = V('WS2M'), rs = V('ALLSKY_SFC_SW_DWN'), pr = V('PRECTOTCORR');
      a.dates.forEach((d8, j) => {
        const d = `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`;
        if (d < from || d > to) return;
        const row = { date: d, rain: pr[j] ?? 0 };
        const ok = [tx[j], tn[j], td[j], ws[j], rs[j]].every(v => v !== null && v !== undefined);
        if (useCorr && ok) {
          const c = eng.correct(corrSite, { date: d, tmax: tx[j], tmin: tn[j], tdew: td[j], rs: rs[j], ws2m: ws[j] }, res);
          Object.assign(row, { tmin: c.tmin, tmax: c.tmax, et0: c.et0, u2: c.u2, rhmin: E().Fao56.rhMin({ DewPoint_C: c.tdew, Tmax_C: c.tmax }), unc: c.unc });
        } else {
          const rec = { Tmin_C: tn[j], Tmax_C: tx[j], DewPoint_C: td[j], RHmean_pct: rh[j], WindSpeed_m_s: ws[j], WindHeight_m: 2, SolarRadiation_MJ_m2_day: rs[j] };
          const r = E().Fao56.et0FromRecord(rec, { Latitude: site.lat, Elevation_m: elev, WindHeight_m: 2 }, new Date(d + 'T00:00:00'));
          Object.assign(row, { tmin: tn[j], tmax: tx[j], et0: r.et0, u2: ws[j], rhmin: E().Fao56.rhMin(rec) });
        }
        out.push(row);
      });
    }
    return { rows: out, cell: cellInfo, corr: res };
  }

  function fieldInputs() {
    const key = $('rpCrop').value, crop = E().Crops.get(key), S = E().Soils.SOILS[$('rpSoil').value], Y = E().Soils.SYSTEMS[$('rpSystem').value];
    return { key, crop, soilKey: $('rpSoil').value, soil: { thetaFC: S.thetaFC, thetaWP: S.thetaWP, cn: S.cn, initialDepletionFrac: 0.5, subsoilDepletionFrac: 0.5 },
      sysKey: $('rpSystem').value, irrigation: { mode: 'scheduled', efficiency: Y.ea, triggerFrac: null, events: [], maxNetMm: Y.maxNetMm, forecastRainProbMin: 60 },
      month: +$('rpMonth').value, day: +$('rpDay').value, mode: $('rpMode').value, rainMode: $('rpRainMode').value };
  }

  /** one season at one site */
  // ---------- seasonal rain quality control
  // Gridded rain (NASA POWER PRECTOTCORR) can be far off in dry regions. Each season is judged in its RAIN YEAR
  // (1 Sep – 31 Aug containing the sowing for winter crops; the rain year that ends in the sowing year for crops sown
  // Mar–Aug) against the median of the other complete rain years of the same NASA cell in the archive.
  //   flag  : ratio ≥ 2 (exceptionally wet) or ≤ 0.5 (exceptionally dry)
  //   modes : 'nasa'    — rain used as it is (flag shown);
  //           'median'  — daily rain scaled so the rain year equals the cell's median (a typical rainfall year);
  //           'station' — daily rain scaled so the rain year equals the station total entered by the user.
  // Scaling keeps the NASA daily timing and changes only the amounts (ratio method).
  const RAINY = new Map();
  const rainYearOf = (y, month) => month >= 9 ? y : y - 1;          // rain year starts 1 Sep of this year
  async function rainYears(site) {
    const key = `${site.lat.toFixed(3)}_${site.lon.toFixed(3)}`;
    if (RAINY.has(key)) return RAINY.get(key);
    const tot = new Map(), cnt = new Map();
    for (const y of ARCHIVE_YEARS) {
      let a; try { a = await year(y); } catch (e) { continue; }
      const ci = nearestCell(a.cells, site.lat, site.lon), pr = a.vars.PRECTOTCORR[ci];
      a.dates.forEach((d8, j) => { const yy = +d8.slice(0, 4), mm = +d8.slice(4, 6), ry = mm >= 9 ? yy : yy - 1;
        if (pr[j] !== null && pr[j] !== undefined) { tot.set(ry, (tot.get(ry) || 0) + pr[j]); cnt.set(ry, (cnt.get(ry) || 0) + 1); } });
    }
    const out = new Map([...tot].map(([ry, v]) => [ry, { total: v, days: cnt.get(ry), complete: cnt.get(ry) >= 360 }]));
    RAINY.set(key, out); return out;
  }
  const median = v => { const x = v.slice().sort((a, b) => a - b), n = x.length; return n ? (n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2) : null; };
  function stationRain(label) {
    for (const l of ($('rpStationRain').value || '').split(/\n/)) {
      const p = l.split(/[,،;\t]/).map(x => x.trim()); if (p.length < 2) continue;
      if (p[0] === label && Number.isFinite(+p[1])) return +p[1];
    }
    return null;
  }

  /** one season at one site */
  async function season(site, y, F) {
    const sow = iso(y, F.month, F.day), end = addDays(sow, 330);
    const W = await weather(site, sow, end);
    if (!W.rows.length) return { site, y, sow, error: 'لا توجد بيانات أرشيف لهذا الموسم' };
    // rain year of this season and its standing among the other years of the cell
    const ry = rainYearOf(y, F.month), RY = await rainYears(site), cur = RY.get(ry);
    const others = [...RY].filter(([k, v]) => k !== ry && v.complete).map(([, v]) => v.total);
    const med = median(others), rainNasa = cur ? cur.total : null, ratio = rainNasa !== null && med ? rainNasa / med : null;
    const flag = ratio === null ? null : ratio >= 2 ? 'wet' : ratio <= 0.5 ? 'dry' : null;
    const label = F.mode === 'temporal' ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : site.name;
    let target = null, rainMode = F.rainMode;
    if (rainMode === 'median' && med) target = med;
    if (rainMode === 'station') { target = stationRain(label); if (target === null) rainMode = 'nasa'; }
    const factor = target !== null && rainNasa > 0 ? target / rainNasa : 1;
    if (factor !== 1) W.rows.forEach(r => { r.rain = (r.rain || 0) * factor; });
    const last = W.rows[W.rows.length - 1].date;
    const out = E().WaterBalance.run({ crop: F.crop, soil: F.soil, irrigation: F.irrigation, sowingDate: sow, endDate: last < end ? last : end, weather: W.rows });
    const days = out.days, hv = days.find(d => d.Stage === 4), s = out.summary;
    const et0 = days.reduce((a, d) => a + (d.ET0 || 0), 0);
    const unc = W.rows.filter(r => r.date >= sow && (!hv || r.date <= hv.Date) && Number.isFinite(r.unc));
    return { site, y, sow, label, harvest: hv ? hv.Date : null, complete: !!hv, len: days.length, et0, etc: s.ETc, etcAdj: s.ETcAdj, p: s.P, pe: s.P - s.RO,
      inet: s.Inet, igross: s.Igross, n: s.irrigations, dp: s.DP, stress: s.stressDays, missing: s.missing, closure: s.MassClosureMm,
      level: W.corr ? W.corr.level : 0, levelAr: W.corr ? W.corr.levelAr : 'ناسا خام', cell: W.cell, uncMean: unc.length ? unc.reduce((a, r) => a + r.unc, 0) / unc.length : null,
      rainYear: `${ry}/${String((ry + 1) % 100).padStart(2, '0')}`, rainYearComplete: !!(cur && cur.complete), rainNasa, rainMedian: med, rainRatio: ratio, rainFlag: flag,
      rainUsedMode: factor !== 1 ? rainMode : 'nasa', rainFactor: factor, rainTarget: factor !== 1 ? target : null, nOthers: others.length };
  }

  // ---------- statistics over the complete rows
  const COLS = [['et0', 'ET₀ للموسم'], ['etc', 'الاحتياج المائي للمحصول ETc'], ['rainNasa', 'مطر السنة المطرية (ناسا)'], ['pe', 'المطر الفعال (P − RO)'], ['inet', 'الري الصافي'], ['igross', 'الري الإجمالي (م³/دونم)'], ['n', 'عدد الريات'], ['dp', 'التسرب العميق'], ['len', 'طول الموسم (يوم)']];
  function stats(rows) {
    const ok = rows.filter(r => !r.error && r.complete);
    return Object.fromEntries(COLS.map(([k]) => {
      const v = ok.map(r => r[k]).filter(Number.isFinite), n = v.length;
      if (!n) return [k, null];
      const m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
      return [k, { n, mean: m, sd, cv: m ? 100 * sd / m : null, min: Math.min(...v), max: Math.max(...v) }];
    }));
  }

  // ---------- render
  const dm = s => s ? `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '—';
  function render(R) {
    const temporal = R.mode === 'temporal';
    const label = r => temporal ? `${r.y}/${String((r.y + 1) % 100).padStart(2, '0')}` : r.site.name;
    const body = R.rows.map(r => r.error ? `<tr><td>${label(r)}</td><td colspan="13" style="color:#b4342b">${r.error}</td></tr>` :
      `<tr${r.complete ? '' : ' style="background:#fff8ea"'}><td><b>${label(r)}</b>${r.complete ? '' : '<br><span class="status warn">موسم غير مكتمل</span>'}${r.rainFlag ? `<br><span class="status ${r.rainFlag === 'wet' ? 'bad' : 'warn'}" title="مطر السنة المطرية ${r.rainYear} مقارنة بوسيط ${r.nOthers} سنوات أخرى للخلية نفسها">${r.rainFlag === 'wet' ? 'مطر استثنائي مرتفع' : 'مطر استثنائي منخفض'} ×${f(r.rainRatio, 1)}</span>` : ''}</td><td>${dm(r.sow)}</td><td>${r.complete ? dm(r.harvest) : 'لم يُبلغ'}</td><td>${r.len}</td>
        <td>${f(r.et0)}</td><td><b>${f(r.etc)}</b></td><td>${f(r.rainNasa)}${r.rainYearComplete ? '' : '*'}${r.rainTarget !== null ? ` ← <b>${f(r.rainTarget)}</b>` : ''}<br><span class="mini">الوسيط ${f(r.rainMedian)}</span></td><td>${f(r.pe)}</td><td><b>${f(r.inet)}</b></td><td>${f(r.igross)}</td><td>${r.n}</td><td>${f(r.dp)}</td><td>${r.stress}</td>
        <td><span class="mini">${r.levelAr}${Number.isFinite(r.uncMean) ? ` (±${f(r.uncMean, 2)} مم/يوم)` : ''}</span></td></tr>`).join('');
    const S = stats(R.rows), sv = (k, p, d = 0) => S[k] ? f(S[k][p], d) : '—';
    const srow = (t, p, d = 0, suf = '') => `<tr style="background:#f1f6f7"><td><b>${t}</b></td><td></td><td></td><td>${sv('len', p, d)}${suf}</td>${['et0', 'etc', 'rainNasa', 'pe', 'inet', 'igross', 'n', 'dp'].map(k => `<td>${sv(k, p, d)}${suf}</td>`).join('')}<td></td><td></td></tr>`;
    const nOk = R.rows.filter(r => !r.error && r.complete).length;
    $('rpOut').innerHTML = `
      <div class="mini" style="margin-bottom:8px">${R.title}. القيم بالمليمتر للموسم (1 مم = 1 م³/دونم). الإحصاء على المواسم أو المواقع المكتملة فقط (${nOk}).</div>
      <div class="table-wrap" style="max-height:none"><table><thead><tr><th>${temporal ? 'الموسم' : 'الموقع'}</th><th>الزراعة</th><th>الحصاد</th><th>الطول يوم</th><th>ET₀</th><th>ETc</th><th>مطر السنة المطرية</th><th>المطر الفعال</th><th>الري الصافي</th><th>الري الإجمالي</th><th>الريات</th><th>التسرب</th><th>أيام إجهاد</th><th>تصحيح ناسا</th></tr></thead>
      <tbody>${body}${nOk > 1 ? srow('المتوسط', 'mean') + srow('الانحراف المعياري', 'sd') + srow('معامل الاختلاف CV', 'cv', 0, '%') + srow('الأدنى', 'min') + srow('الأعلى', 'max') : ''}</tbody></table></div>
      <h4 style="margin:16px 0 6px">${temporal ? 'التباين الزماني' : 'التباين المكاني'}: الاحتياج المائي والمطر الفعال والري الصافي</h4>
      <div class="chart-shell" style="height:auto"><svg id="rpChart" viewBox="0 0 1000 360" style="width:100%;height:auto;direction:ltr"></svg></div>
      <div class="chart-legend" style="display:flex;gap:16px;flex-wrap:wrap">${[["#C0571B","الاحتياج المائي ETc"],["#2F6FB3","المطر الفعال"],["#2E8B57","الري الصافي"]].map(([c,t])=>`<span style="display:inline-flex;align-items:center;gap:6px"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c}"></i>${t}</span>`).join("")}</div>
      <div class="mini" style="margin-top:8px">المنهجية: موازنة مائية يومية FAO-56 (Kc مفرد) بنفس محرك بطاقة الحقل، ري تلقائي عند RAW بكفاءة النظام وحده الأقصى للرية، استنزاف أولي 50%، الحصاد بنهاية الأطوار: بالتراكم الحراري للمحاصيل المعايرة حرارياً، وبأطوال الأطوار بالأيام للمحاصيل المحلية (الملحقان 1 و2، دون تعديل مناخي لـ Kc). المناخ: أرشيف NASA POWER ${R.corrOn ? 'مصححاً محلياً بإعدادات شاشة المناخ (نوع الموقع ومعامل الرياح)' : 'دون تصحيح'}. الارتفاع ارتفاع الموقع إن أُدخل، وإلا ارتفاع خلية ناسا. المطر: ${({ nasa: 'من ناسا كما هو', median: 'مطر ناسا اليومي معدّلاً بالنسبة حتى يساوي مجموع السنة المطرية وسيطَ السنوات الأخرى للخلية (سنة مطرية نموذجية)', station: 'مطر ناسا اليومي معدّلاً بالنسبة حتى يساوي مجموع السنة المطرية مطرَ المحطة المُدخل' })[R.rainMode]}. السنة المطرية من 1 أيلول إلى 31 آب؛ يُنبَّه إلى السنة التي يبلغ مطرها ضعف وسيط السنوات الأخرى للخلية أو نصفه. * سنة مطرية غير مكتملة في الأرشيف.</div>`;
    drawChart(R, label);
    $('rpExport').disabled = false;
  }
  function drawChart(R, label) {
    const svg = $('rpChart'), rows = R.rows.filter(r => !r.error), W = 1000, H = 360, m = { l: 50, r: 10, t: 14, b: 60 };
    if (!rows.length) { svg.innerHTML = ''; return; }
    const max = Math.ceil(Math.max(...rows.map(r => Math.max(r.etc, r.pe, r.inet))) / 100) * 100 || 100;
    const y = v => H - m.b - v / max * (H - m.t - m.b), gw = (W - m.l - m.r) / rows.length, bw = Math.min(28, gw / 4);
    let s = '';
    for (let v = 0; v <= max; v += max / 5) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3ecee"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b8086">${Math.round(v)}</text>`;
    s += `<text x="${m.l - 40}" y="${m.t + 4}" font-size="11" fill="#6b8086">مم</text>`;
    rows.forEach((r, i) => {
      const x0 = m.l + gw * i + gw / 2 - 1.5 * bw - 2;
      [[r.etc, '#C0571B', 'ETc'], [r.pe, '#2F6FB3', 'المطر الفعال'], [r.inet, '#2E8B57', 'الري الصافي']].forEach(([v, c, n], k) => {
        const x = x0 + k * (bw + 2), h = Math.max(0, y(0) - y(v));
        s += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${h}" rx="2" fill="${c}" opacity="${r.complete ? 1 : 0.45}"><title>${label(r)} — ${n}: ${f(v)} مم${r.complete ? '' : ' (غير مكتمل)'}</title></rect>`;
      });
      s += `<text x="${m.l + gw * i + gw / 2}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="#33474c">${label(r)}</text>`;
      s += `<text x="${m.l + gw * i + gw / 2}" y="${H - m.b + 30}" text-anchor="middle" font-size="10" fill="#6b8086" direction="rtl">ري ${f(r.inet)} مم</text>`;
    });
    svg.innerHTML = s;
  }

  async function produce() {
    const F = fieldInputs(), mode = $('rpMode').value, btn = $('rpRun'), st = $('rpStatus');
    let jobs = [], title;
    if (mode === 'temporal') {
      const site = $('rpSite').value === 'custom' ? customSites()[0] : sites().find(s => s.key === $('rpSite').value);
      if (!site) { toast('اختر موقعاً أو أدخل موقعاً مخصصاً'); return; }
      const ys = [...document.querySelectorAll('#rpYears input:checked')].map(i => +i.value);
      if (!ys.length) { toast('اختر موسماً واحداً على الأقل'); return; }
      jobs = ys.map(y => [site, y]); title = `${F.crop.name} في ${site.name}، الزراعة ${F.day} ${MONTHS[F.month - 1]}، ${ys.length} مواسم`;
    } else {
      const y = +$('rpYear').value, chosen = [...document.querySelectorAll('#rpSites input:checked')].map(i => sites().find(s => s.key === i.value)).concat(customSites());
      if (!chosen.length) { toast('اختر موقعاً واحداً على الأقل'); return; }
      jobs = chosen.map(s => [s, y]); title = `${F.crop.name} موسم ${y}/${String((y + 1) % 100).padStart(2, '0')}، الزراعة ${F.day} ${MONTHS[F.month - 1]}، ${chosen.length} مواقع`;
    }
    btn.disabled = true; const rows = [];
    for (let i = 0; i < jobs.length; i++) {
      st.textContent = `جارٍ الحساب ${i + 1} من ${jobs.length}: ${jobs[i][0].name} ${jobs[i][1]}…`;
      try { rows.push(await season(jobs[i][0], jobs[i][1], F)); } catch (e) { rows.push({ site: jobs[i][0], y: jobs[i][1], error: e.message || 'تعذر الحساب' }); }
      await new Promise(r => setTimeout(r));
    }
    btn.disabled = false; st.textContent = `اكتمل: ${rows.length} حساب.`;
    LAST = { mode, title, rows, F, rainMode: F.rainMode, corrOn: !!(window.CORRUI && CORRUI.cfg.on), at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    render(LAST);
  }

  function exportXlsx() {
    if (!LAST || typeof XLSX === 'undefined') { toast('مكتبة Excel غير محمّلة'); return; }
    const t = LAST.mode === 'temporal';
    const head = [t ? 'الموسم' : 'الموقع', 'خط العرض', 'خط الطول', 'الزراعة', 'الحصاد', 'مكتمل', 'طول الموسم يوم', 'ET0 مم', 'ETc مم', 'المطر مم', 'المطر الفعال مم', 'الري الصافي مم', 'الري الإجمالي مم (م3/دونم)', 'عدد الريات', 'السنة المطرية', 'مطر السنة المطرية ناسا مم', 'وسيط السنوات الأخرى مم', 'النسبة إلى الوسيط', 'تنبيه المطر', 'المطر المستخدم للسنة مم', 'طريقة المطر', 'التسرب مم', 'أيام إجهاد', 'مستوى التصحيح', 'هامش ET0 اليومي مم', 'إغلاق الكتلة مم'];
    const data = LAST.rows.map(r => r.error ? [t ? r.y : r.site.name, r.site.lat, r.site.lon, r.error] :
      [t ? `${r.y}/${r.y + 1}` : r.site.name, r.site.lat, r.site.lon, r.sow, r.harvest || '', r.complete ? 'نعم' : 'لا', r.len, +f(r.et0, 1), +f(r.etc, 1), +f(r.p, 1), +f(r.pe, 1), +f(r.inet, 1), +f(r.igross, 1), r.n, r.rainYear, +f(r.rainNasa, 0), +f(r.rainMedian, 0), +f(r.rainRatio, 2), r.rainFlag === 'wet' ? 'مرتفع استثنائي' : r.rainFlag === 'dry' ? 'منخفض استثنائي' : '', r.rainTarget !== null ? +f(r.rainTarget, 0) : +f(r.rainNasa, 0), ({ nasa: 'ناسا كما هو', median: 'معدّل إلى الوسيط', station: 'معدّل إلى مطر المحطة' })[r.rainUsedMode], +f(r.dp, 1), r.stress, r.levelAr, Number.isFinite(r.uncMean) ? +f(r.uncMean, 2) : '', r.closure]);
    const S = stats(LAST.rows), keys = ['len', 'et0', 'etc', 'rainNasa', 'pe', 'inet', 'igross', 'n', 'dp'];
    const sheetS = [['المؤشر', 'n', 'المتوسط', 'الانحراف المعياري', 'CV %', 'الأدنى', 'الأعلى'], ...keys.filter(k => S[k]).map(k => [COLS.find(c => c[0] === k)[1], S[k].n, +f(S[k].mean, 1), +f(S[k].sd, 1), +f(S[k].cv, 1), +f(S[k].min, 1), +f(S[k].max, 1)])];
    const F = LAST.F, inputs = [['التقرير', LAST.title], ['المحصول', F.crop.name], ['موعد الزراعة', `${F.day} ${MONTHS[F.month - 1]}`], ['التربة', E().Soils.SOILS[F.soilKey].name], ['نظام الري', E().Soils.SYSTEMS[F.sysKey].name],
      ['كفاءة الإضافة Ea', F.irrigation.efficiency], ['أقصى عمق صافٍ للرية مم', F.irrigation.maxNetMm], F.crop.stageDays ? ['أطوال الأطوار L1–L4 (يوم)', F.crop.stageDays.join('/')] : ['حدود الأطوار GDD', `${F.crop.gdd.iniEnd}/${F.crop.gdd.devEnd}/${F.crop.gdd.midEnd}/${F.crop.gdd.lateEnd}`], ['معامل المحصول Kc ini/mid/end', `${F.crop.kcIni}/${F.crop.kcMid}/${F.crop.kcEnd}${F.crop.kcLocal ? ' (محلي، دون تعديل مناخي)' : ''}`],
      ['تصحيح ناسا', LAST.corrOn ? 'مفعّل' : 'معطّل'], ['المطر', ({ nasa: 'ناسا كما هو', median: 'معدّل إلى وسيط السنوات الأخرى للخلية', station: 'معدّل إلى مطر المحطة المُدخل' })[LAST.rainMode]], ['المنهجية', 'FAO-56 Kc مفرد، ري تلقائي عند RAW، استنزاف أولي 50%، الحصاد بالتراكم الحراري'], ['أُنتج', LAST.at + ' — المنصة السورية لإدارة وجدولة الري']];
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([head, ...data]); ws1['!views'] = [{ RTL: true }];
    const ws2 = XLSX.utils.aoa_to_sheet(sheetS); ws2['!views'] = [{ RTL: true }];
    const ws3 = XLSX.utils.aoa_to_sheet(inputs); ws3['!views'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws1, 'التقرير'); XLSX.utils.book_append_sheet(wb, ws2, 'الإحصاء'); XLSX.utils.book_append_sheet(wb, ws3, 'المعطيات');
    XLSX.writeFile(wb, `تقرير_الاحتياج_المائي_${F.key}_${t ? 'زماني' : 'مكاني'}.xlsx`);
  }

  // ---------- form
  function fillForm(years) {
    const C = E().Crops, S = E().Soils;
    $('rpCrop').innerHTML = (C.GROUPS || []).map(g => `<optgroup label="${g}">${C.keys.filter(k => C.CROPS[k].group === g).map(k => `<option value="${k}">${C.CROPS[k].name}</option>`).join('')}</optgroup>`).join('');
    $('rpSoil').innerHTML = Object.entries(S.SOILS).map(([k, v]) => `<option value="${k}"${k === 'siltLoam' ? ' selected' : ''}>${v.name}</option>`).join('');
    $('rpSystem').innerHTML = Object.entries(S.SYSTEMS).map(([k, v]) => `<option value="${k}"${k === 'sprinkler' ? ' selected' : ''}>${v.name} (Ea ${v.ea})</option>`).join('');
    $('rpMonth').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    $('rpDay').innerHTML = Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join('');
    const setSow = () => { const md = C.CROPS[$('rpCrop').value].sowMonthDay.split('-'); $('rpMonth').value = +md[0]; $('rpDay').value = +md[1]; };
    $('rpCrop').onchange = setSow; setSow();
    const all = sites();
    $('rpSite').innerHTML = ['مناطق زراعية', 'مراكز المحافظات'].map(g => `<optgroup label="${g}">${all.filter(s => s.group === g).map(s => `<option value="${s.key}">${s.name}</option>`).join('')}</optgroup>`).join('') + '<option value="custom">أول موقع في «مواقع مخصصة»</option>';
    $('rpSite').value = 'eco:salamiyah';
    $('rpSites').innerHTML = ['مناطق زراعية', 'مراكز المحافظات'].map(g => `<div class="mini" style="grid-column:1/-1;margin-top:4px"><b>${g}</b></div>` + all.filter(s => s.group === g).map(s => `<label class="rp-chk"><input type="checkbox" value="${s.key}"${s.group === 'مناطق زراعية' ? ' checked' : ''}> ${s.name}</label>`).join('')).join('');
    // a season whose sowing date is after the last archive day has no data yet: listed, but not ticked
    const hasData = y => !LASTDATE || iso(y, +$('rpMonth').value, +$('rpDay').value) <= LASTDATE;
    const fillYears = () => { $('rpYears').innerHTML = years.map(y => `<label class="rp-chk"><input type="checkbox" value="${y}"${hasData(y) ? ' checked' : ''}> ${y}/${String((y + 1) % 100).padStart(2, '0')}${hasData(y) ? '' : ' <span class="mini">(لا بيانات بعد)</span>'}</label>`).join(''); };
    fillYears(); $('rpMonth').addEventListener('change', fillYears); $('rpCrop').addEventListener('change', fillYears);
    $('rpYear').innerHTML = years.map(y => `<option value="${y}">${y}/${String((y + 1) % 100).padStart(2, '0')}</option>`).join('');
    $('rpYear').value = years[Math.max(0, years.length - 2)];
    const mode = () => { const t = $('rpMode').value === 'temporal'; $('rpTemporal').hidden = !t; $('rpSpatial').hidden = t; $('rpTemporalBox').hidden = !t; $('rpSpatialBox').hidden = t; };
    $('rpMode').onchange = mode; mode();
  }
  async function init() {
    if (!$('rpRun')) return;
    let years = [2021, 2022, 2023, 2024, 2025, 2026];
    try { const idx = await archiveJson('index.json'); if (idx && idx.years) years = idx.years; if (idx && idx.last_date) LASTDATE = `${idx.last_date.slice(0, 4)}-${idx.last_date.slice(4, 6)}-${idx.last_date.slice(6, 8)}`; } catch (e) { }
    ARCHIVE_YEARS = years;
    fillForm(years);
    $('rpRun').onclick = produce; $('rpExport').onclick = exportXlsx;
    $('rpRainMode').onchange = () => { if ($('rpRainMode').value === 'station') $('rpStationBox').open = true; };
  }
  window.REPORTS = { produce, season, stats, last: () => LAST };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
