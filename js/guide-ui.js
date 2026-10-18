/* Guide, worked examples and feedback — UI only (no science here).
 * Feedback: the static site cannot store messages, so the form composes a structured message
 * (note + automatic context) and hands it to WhatsApp / e-mail / clipboard. Destinations: access.json → feedback. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const VERSION = 'v0.8';
  let CFG = { email: '', whatsapp: '' };
  const LS_WELCOME = 'gcsar.welcome.dismissed.v1';

  async function loadCfg() {
    try { const r = await fetch('access.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); CFG = { ...CFG, ...(j.feedback || {}) }; } } catch (e) { }
    $('fbWa').hidden = !CFG.whatsapp; $('fbMail').hidden = !CFG.email;
  }

  // ---------- worked examples (one click: archive → visual review → approve → balance)
  async function example(kind) {
    const ex = kind === 'wheat'
      ? { lat: 35.01, lon: 37.05, start: '2025-10-15', end: '2026-06-15', crop: 'wheat', sow: '2025-11-20', name: 'مثال — قمح سلمية 2025/26', system: 'sprinkler', fend: '2026-06-10' }
      : { lat: 35.32, lon: 36.32, start: '2026-06-15', end: dateKey(new Date()), crop: 'maize', sow: '2026-07-01', name: 'مثال — ذرة تكثيفية في الغاب 2026 (مع التوقعات)', system: 'sprinkler', fend: '2026-12-31' };
    toast('جارٍ تحميل المثال من أرشيف المنصة…');
    showSection('climate');
    $('nasaMode').value = 'archive'; $('nasaStart').value = ex.start; $('nasaEnd').value = ex.end; $('nasaLat').value = ex.lat; $('nasaLon').value = ex.lon; nasaModeChanged();
    await downloadNasa();
    if (!state.rows.length) { toast('تعذر تحميل المثال'); return; }
    state.visualReviewed = true;           // examples only: the visual review is taken as done so the flow can be shown end-to-end
    approve();
    showSection('balance');
    $('wbName').value = ex.name; $('wbCrop').value = ex.crop; $('wbCrop').onchange({ target: $('wbCrop') });
    $('wbSow').value = ex.sow; $('wbEnd').value = ex.fend; $('wbSystem').value = ex.system; $('wbSystem').onchange({ target: $('wbSystem') });
    $('wbMode').value = 'scheduled'; $('wbTrigger').value = ''; $('wbUseFc').value = '1';
    await WB.run();
    window.scrollTo({ top: 0 });
    toast('مثال توضيحي: الاعتماد تم تلقائياً لأغراض العرض فقط');
  }

  // ---------- feedback
  function context() {
    const sec = document.querySelector('.section.active')?.id || '';
    const names = { dashboard: 'لوحة التحكم', climate: 'المناخ و ET₀', crop: 'المحصول والفينولوجيا', balance: 'الموازنة المائية والري', map: 'خريطة سورية', data: 'سجل البيانات', guide: 'الدليل' };
    const lines = [`الشاشة: ${names[sec] || sec}`, `الإصدار: ${VERSION} — ${new Date().toLocaleString('ar-SY')}`];
    if (state.rows?.length) lines.push(`المناخ: ${state.sourceLabel || state.station?.StationName || ''} (${state.station?.Latitude}, ${state.station?.Longitude}) — ${state.rows.length} يوماً${state.approved ? ' — معتمد' : ''}`);
    const L = window.WB && WB.last;
    if (L) {
      const f = L.field, s = L.out.summary, r = L.out.recommendation;
      lines.push(`الحقل: ${f.name} — ${f.crop.name} زراعة ${f.sowingDate} — تربة θFC ${f.soil.thetaFC}/θWP ${f.soil.thetaWP} — ${({ scheduled: 'جدولة تلقائية', actual: 'ريات مسجلة', rainfed: 'بعلي' })[f.irrigation.mode] || f.irrigation.mode}، Ea ${f.irrigation.efficiency}، حد الرية ${f.irrigation.maxNetMm ?? '—'} مم`);
      lines.push(`النتائج: P ${s.P} مم، ETc ${s.ETc}، ETc,adj ${s.ETcAdj}، ري إجمالي ${s.Igross} مم (${s.irrigations} رية)، إغلاق ${s.MassClosureMm}`);
      if (r?.alert) lines.push(`التنبيه: ${({ now: 'ري الآن', soon: 'ري متوقع', ok: 'لا حاجة خلال التوقع', harvested: 'انتهى الموسم' })[r.alert.level] || r.alert.level}${r.alert.firstNeedDate ? ' — أول حاجة ' + r.alert.firstNeedDate : ''}`);
    }
    return lines.join('\n');
  }
  function compose() {
    const who = [$('fbName').value.trim(), $('fbOrg').value.trim()].filter(Boolean).join(' — ');
    const parts = [`ملاحظة على المنصة السورية لإدارة وجدولة الري`, `النوع: ${$('fbType').value}`];
    if (who) parts.push(`المرسل: ${who}`);
    parts.push('', $('fbText').value.trim() || '(دون نص)');
    if ($('fbCtx').checked) parts.push('', '— السياق التلقائي —', context());
    return parts.join('\n');
  }
  function openFeedback() {
    $('fbPreview').textContent = $('fbCtx').checked ? context() : '(لن يُرفق السياق)';
    $('fbModal').hidden = false; $('fbText').focus();
  }
  function send(channel) {
    if (!$('fbText').value.trim()) { toast('اكتب الملاحظة أولاً'); return; }
    const msg = compose();
    if (channel === 'wa') window.open(`https://wa.me/${CFG.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
    else if (channel === 'mail') location.href = `mailto:${CFG.email}?subject=${encodeURIComponent('ملاحظة — منصة الري ' + VERSION)}&body=${encodeURIComponent(msg.slice(0, 1800))}`;
    else navigator.clipboard?.writeText(msg).then(() => toast('نُسخ النص — الصقه في أي تطبيق مراسلة'), () => toast('تعذر النسخ'));
  }

  // ---------- welcome banner (first visit)
  function welcome() {
    let seen = false; try { seen = localStorage.getItem(LS_WELCOME) === '1'; } catch (e) { }
    const box = $('welcomeBox'); if (!box || seen) return;
    box.hidden = false;
    $('welcomeClose').onclick = () => { box.hidden = true; try { localStorage.setItem(LS_WELCOME, '1'); } catch (e) { } };
  }

  function init() {
    $('exWheat').onclick = () => example('wheat');
    $('exMaize').onclick = () => example('maize');
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showSection(b.dataset.go));
    document.querySelectorAll('.js-feedback').forEach(b => b.onclick = openFeedback);
    $('fbClose').onclick = () => $('fbModal').hidden = true;
    $('fbModal').onclick = e => { if (e.target.id === 'fbModal') $('fbModal').hidden = true; };
    $('fbCtx').onchange = () => $('fbPreview').textContent = $('fbCtx').checked ? context() : '(لن يُرفق السياق)';
    $('fbWa').onclick = () => send('wa'); $('fbMail').onclick = () => send('mail'); $('fbCopy').onclick = () => send('copy');
    loadCfg(); welcome();
  }
  window.GUIDE = { init, example };
})();
