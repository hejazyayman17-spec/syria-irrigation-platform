/* NASA POWER correction — UI and the link with the climate rows (no equations here; see js/engine/correction.js).
 * Corrected inputs replace the NASA values in each row (the raw values are kept in r._raw and restored before any
 * recomputation), and r._et0 becomes the corrected ET0 computed by the correction engine itself (rule: the FAO-56
 * variant of the research code is not re-implemented elsewhere). GDD, the water balance and the crop screen therefore
 * all use the corrected series. Station files (ground data) are never corrected. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.GCSAR && GCSAR.Correction;
  const ENG = (() => { try { return C.engine(GCSAR_CORRECTION_MODEL); } catch (e) { return null; } })();
  const VAL = (() => { try { return GCSAR_CORRECTION_VALIDATION; } catch (e) { return null; } })();
  const LS = 'gcsar.corr.v1';
  const KEYS = ['Tmax_C', 'Tmin_C', 'DewPoint_C', 'SolarRadiation_MJ_m2_day', 'WindSpeed_m_s'];
  const cfg = (() => { const d = { on: true, siteType: 'ordinary', windFactor: null }; try { return { ...d, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch (e) { return d; } })();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { } };
  const f = (v, d = 2) => Number.isFinite(v) ? (+v).toFixed(d) : '—';

  const isNasa = () => (state.rows || []).some(r => r.DataFlag === 'NASA-POWER-grid') || /NASA/.test(state.sourceLabel || '');

  /** called by processRows(meta) after the raw ET0 of every row is known */
  function apply(m) {
    state.corrRes = null;
    if (!ENG || !cfg.on || !isNasa()) return;
    const site = { lat: +m.Latitude, lon: +m.Longitude, elevationM: Number.isFinite(+m.Elevation_m) ? +m.Elevation_m : 0,
      siteType: cfg.siteType, measuredWindFactor: Number.isFinite(cfg.windFactor) ? cfg.windFactor : null };
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return;
    const res = ENG.resolve(site);
    let n = 0, skipped = 0;
    state.rows.forEach(r => {
      if ((num(r.WindHeight_m) ?? 2) !== 2) { skipped++; return; }      // NASA POWER wind is at 2 m
      const x = { tmax: num(r.Tmax_C), tmin: num(r.Tmin_C), tdew: num(r.DewPoint_C), rs: num(r.SolarRadiation_MJ_m2_day), ws2m: num(r.WindSpeed_m_s) };
      if (Object.values(x).some(v => v === null)) { skipped++; return; }
      const c = ENG.correct(site, { date: dateKey(r._date), ...x }, res);
      r._raw = { inputs: Object.fromEntries(KEYS.map(k => [k, r[k]])), et0: r._et0 };
      r._corr = c;
      r.Tmax_C = c.tmax; r.Tmin_C = c.tmin; r.DewPoint_C = c.tdew; r.SolarRadiation_MJ_m2_day = c.rs; r.WindSpeed_m_s = c.u2;
      r._et0 = c.et0; r._res = { ...r._res, u2: c.u2, corrected: true };
      n++;
    });
    state.corrRes = { ...res, site, n, skipped };
  }

  // ---------- rendering
  const VAR_AR = { tmax: 'الحرارة العظمى °م', tmin: 'الحرارة الصغرى °م', tdew: 'نقطة الندى °م', rs: 'الإشعاع الشمسي MJ/m²', u2: 'الرياح على 2 م m/s', et0: 'ET₀ مم/يوم' };
  const MET = [['n', 'n', 0], ['MBE', 'الانحياز MBE', 2], ['bias_pct', 'الانحياز %', 1], ['MAE', 'MAE', 2], ['RMSE', 'RMSE', 2], ['nRMSE', 'nRMSE %', 1], ['d', 'Willmott d', 3], ['NSE', 'NSE', 3], ['KGE', 'KGE', 3], ['r', 'r', 3]];
  // better = closer to 0 (errors) or closer to 1 (agreement indices)
  const better = (k, a, b) => !Number.isFinite(a) || !Number.isFinite(b) ? null : (['d', 'NSE', 'KGE', 'r'].includes(k) ? b > a + 1e-9 : Math.abs(b) < Math.abs(a) - 1e-9);
  function cellPair(k, raw, cor, d) {
    const a = raw && raw[k], b = cor && cor[k];
    if (!Number.isFinite(a) && !Number.isFinite(b)) return '<td>—</td>';
    if (k === 'n') return `<td>${f(b ?? a, 0)}</td>`;
    const g = better(k, a, b), col = g === null ? '' : g ? 'color:#2f7a45' : 'color:#b4342b';
    return `<td><span style="color:#6b8086">${f(a, d)}</span> → <b style="${col}">${f(b, d)}</b></td>`;
  }
  function validationHtml(r) {
    if (r.level === 2) return `<div class="mini" style="margin-top:8px"><b>تحقق المعادلة الإقليمية (${r.region.name_ar}):</b> ${r.region.evidence_ar}</div>`;
    if (r.level !== 3) return '<div class="mini" style="margin-top:8px">لا محطة مرجعية في خلية هذا الموقع، فلا توجد مؤشرات توافق منشورة له.</div>';
    const v = VAL && VAL.cells[r.cell.id];
    if (!v) return '';
    const rows = Object.entries(v.variables).filter(([k]) => VAR_AR[k]).map(([k, x]) =>
      `<tr><td style="white-space:normal;text-align:right"><b>${VAR_AR[k]}</b><br><span class="mini">${x.method || ''}</span></td>${MET.map(([m, , d]) => cellPair(m, x.raw, x.corrected, d)).join('')}</tr>`).join('');
    const full = v.et0_nasa_full_raw ? `<br>ET₀ ناسا الخام بكل مدخلاتها (مع الرياح) في هذه المحطة: انحياز ${f(v.et0_nasa_full_raw.bias_pct, 1)}%، RMSE ${f(v.et0_nasa_full_raw.RMSE)} مم/يوم.` : '';
    return `<h4 style="margin:14px 0 6px">مؤشرات التوافق مع المحطة المرجعية (${v.station}): ناسا الخام ← بعد التصحيح</h4>
      <div class="table-wrap" style="max-height:none"><table><thead><tr><th>المتغير</th>${MET.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="mini" style="margin-top:6px">قيم يومية من التحقق في المحطة المرجعية للخلية (بيانات البحث). الأخضر تحسّن بعد التصحيح، والأحمر تراجع. الانحياز = المحسوب − المقيس (MBE بوحدة المتغير، و% نسبةً إلى متوسط المقيس). d وNSE وKGE وr كلما اقتربت من 1 كان التوافق أفضل. الخانات الفارغة لم تُحسب في البحث لهذه المحطة.${full}</div>`;
  }
  function seriesHtml(r) {
    const rows = state.rows.filter(x => x._corr), n = rows.length;
    if (!n) return '';
    const mean = g => rows.reduce((a, x) => a + g(x), 0) / n;
    const raw = mean(x => x._corr.et0Raw), cor = mean(x => x._corr.et0), unc = mean(x => x._corr.unc);
    const dTx = mean(x => x._corr.tmax - x._raw.inputs.Tmax_C), dTn = mean(x => x._corr.tmin - x._raw.inputs.Tmin_C), dU = mean(x => x._corr.u2 / x._raw.inputs.WindSpeed_m_s);
    const stats = C.agreement(rows.map(x => x._corr.et0), rows.map(x => x._corr.et0Raw));   // NASA raw measured against the corrected series
    // monthly table: calendar months for short series, month of year for long ones
    const long = n > 730, groups = new Map();
    rows.forEach(x => { const k = long ? dateKey(x._date).slice(5, 7) : dateKey(x._date).slice(0, 7); const g = groups.get(k) || []; g.push(x); groups.set(k, g); });
    const mrows = [...groups].sort().map(([k, g]) => { const m = h => g.reduce((a, x) => a + h(x), 0) / g.length; const a = m(x => x._corr.et0Raw), b = m(x => x._corr.et0);
      return `<tr><td>${k}</td><td>${g.length}</td><td>${f(a)}</td><td><b>${f(b)}</b></td><td>±${f(m(x => x._corr.unc))}</td><td>${f(100 * (a - b) / b, 1)}%</td></tr>`; }).join('');
    const kpi = (l, v, s) => `<div class="kpi"><div class="label">${l}</div><div class="value" style="font-size:20px">${v}</div><div class="sub">${s || ''}</div></div>`;
    return `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:10px">
        ${kpi('أيام مصححة', `${n}`, r.skipped ? `${r.skipped} يوماً دون تصحيح (بيانات ناقصة)` : 'كل أيام السلسلة')}
        ${kpi('متوسط ET₀ اليومي', `${f(cor)} مم`, `ناسا الخام ${f(raw)} مم`)}
        ${kpi('فرق ناسا الخام عن المصحح', `${raw >= cor ? '+' : ''}${f(100 * (raw - cor) / cor, 1)}%`, `MBE ${raw >= cor ? '+' : ''}${f(raw - cor)} مم/يوم مقارنة بالمصحح`)}
        ${kpi('هامش الخطأ اليومي', `±${f(unc)} مم`, `مجال ET₀ ${f(Math.max(0, cor - unc))}–${f(cor + unc)} مم`)}
        ${kpi('مجموع ET₀ للفترة', `${f(cor * n, 0)} مم`, `ناسا الخام ${f(raw * n, 0)} مم`)}
        ${kpi('أثر التصحيح على المدخلات', `<span dir="ltr">Tmax ${dTx >= 0 ? '+' : ''}${f(dTx, 1)}°</span>`, `Tmin ${dTn >= 0 ? '+' : ''}${f(dTn, 1)}° · الرياح ×${f(dU)}`)}
      </div>
      ${stats ? `<div class="mini" style="margin-top:6px">الفرق اليومي بين ناسا الخام والمصحح في هذه السلسلة: RMSE ${f(stats.RMSE)} مم، MAE ${f(stats.MAE)} مم، r ${f(stats.r, 3)}. هذا يقيس حجم التصحيح، أما دقته فتقيسها مؤشرات المحطة المرجعية أدناه.</div>` : ''}
      <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;font-size:13px">ET₀ ${long ? 'حسب شهر السنة' : 'الشهري'}: الخام والمصحح والهامش</summary>
        <div class="table-wrap" style="max-height:320px;margin-top:8px"><table><thead><tr><th>${long ? 'الشهر' : 'الشهر'}</th><th>أيام</th><th>ET₀ الخام</th><th>ET₀ المصحح</th><th>الهامش ±</th><th>انحياز الخام %</th></tr></thead><tbody>${mrows}</tbody></table></div></details>`;
  }
  function render() {
    const out = $('corrOut'), badge = $('corrBadge');
    if (!out) return;
    $('corrOn').value = cfg.on ? '1' : '0'; $('corrSite').value = cfg.siteType; $('corrWind').value = Number.isFinite(cfg.windFactor) ? cfg.windFactor : '';
    if (!ENG) { badge.className = 'status bad'; badge.textContent = 'ملف المعاملات غير محمّل'; out.innerHTML = ''; return; }
    if (!state.rows || !state.rows.length || !isNasa()) { badge.className = 'status info'; badge.textContent = state.rows && state.rows.length ? 'بيانات محطة — لا تصحيح' : 'بانتظار بيانات ناسا'; out.innerHTML = ''; return; }
    if (!cfg.on) { badge.className = 'status warn'; badge.textContent = 'ناسا الخام'; out.innerHTML = '<div class="mini">التصحيح معطّل: ET₀ والحرارة من ناسا الخام كما هي.</div>'; return; }
    const r = state.corrRes;
    if (!r) { badge.className = 'status warn'; badge.textContent = 'تعذر التصحيح'; out.innerHTML = '<div class="mini">أدخل إحداثيات الموقع في «بيانات المحطة / النقطة».</div>'; return; }
    badge.className = r.level === 3 ? 'status ok' : 'status warn'; badge.textContent = r.levelAr;
    const ce = num(state.station && state.station.CellElevation_m);
    const elevWarn = ce !== null && Math.abs(ce - r.site.elevationM) < 0.5
      ? `<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:#fdeaea;border:1px solid #f3c2bd"><b style="color:#b4342b">الارتفاع المستخدم هو ارتفاع خلية ناسا (${f(ce, 0)} م) لا ارتفاع حقلك.</b> <span class="mini">الارتفاع يدخل في الضغط الجوي والإشعاع الصافي؛ أدخل ارتفاع الحقل الفعلي في «بيانات المحطة / النقطة» ثم اضغط «تطبيق».</span></div>` : '';
    const wind = r.windSource === 'measured' ? `معامل مقاس ${f(r.windFactor)} (دون هامش رياح)` : r.windSource === 'cell' ? 'معادلة رياح الخلية' : `معامل افتراضي لموقع ${C.SITE_AR[cfg.siteType]} ${f(r.windFactor)} (±${r.windUncertaintyPct}%)`;
    out.innerHTML = `<div class="qc-list">
        <div class="qc-item"><span>مستوى التصحيح</span><b>${r.description}</b></div>
        <div class="qc-item"><span>الرياح</span><span>${wind}</span></div>
        <div class="qc-item"><span>خلية ناسا / ارتفاع الموقع</span><span dir="ltr">${r.cellId} · ${f(r.site.elevationM, 0)} m</span></div></div>
      ${elevWarn}${r.warnings.length ? `<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:#fff5df;border:1px solid #f0d9a8"><b style="color:#9a5b00">تحذيرات حدود الاستخدام</b><ul style="margin:4px 0 0;padding-inline-start:18px">${r.warnings.map(w => `<li class="mini" style="color:#5c4510">${w}</li>`).join('')}</ul></div>` : ''}
      ${seriesHtml(r)}${validationHtml(r)}`;
  }
  /** one line for the water-balance notice */
  function summaryLine() {
    const r = state.corrRes; if (!r) return '';
    const rows = state.rows.filter(x => x._corr); if (!rows.length) return '';
    const u = rows.reduce((a, x) => a + x._corr.unc, 0) / rows.length;
    return `ET₀ مصحح محلياً (${r.levelAr}، هامش يومي ±${u.toFixed(2)} مم)`;
  }

  function init() {
    if (!$('corrApply')) return;
    $('corrApply').onclick = () => {
      cfg.on = $('corrOn').value === '1'; cfg.siteType = $('corrSite').value;
      const w = $('corrWind').value; cfg.windFactor = w === '' ? null : +w; save();
      if (state.rows && state.rows.length) { processRows(); toast(cfg.on ? 'طُبّق التصحيح — راجع البيانات واعتمدها من جديد' : 'عادت البيانات إلى ناسا الخام'); }
      else render();
    };
    render();
  }
  window.CORRUI = { apply, render, summaryLine, cfg, engine: ENG };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
