# عقد المحرك العلمي — جسر HTML ↔ .NET

**الإصدار:** 0.7 — 16 تشرين الأول 2026

## المبدأ
المحرك العلمي مفصول تماماً عن الواجهة. كل ملف في `js/engine/` دوالّه نقية: لا تقرأ من الصفحة ولا تكتب إليها.
عند الانتقال إلى .NET يُنقل كل ملف إلى صنف C# مقابل، **بنفس أسماء الحقول والوحدات**.
ملفات JSON المحفوظة (الحقول، أرشيف ناسا) تُقرأ في النسختين دون تحويل.
وحالات الاختبار في `tests/vectors/` هي معيار القبول المشترك: يجب أن تعطي النسختان النتائج نفسها.

## التقابل بين الملفات والأصناف
| ملف JS (الآن) | صنف C# (لاحقاً) | المسؤولية |
|---|---|---|
| `js/engine/fao56.js` | `GCSAR.Irrigation.Core.Fao56` | ET₀ وفق FAO-56 PM، و e°، وتصحيح الرياح، وRHmin، وتعديل Kc مناخياً (Eq. 62) |
| `js/engine/crops.js` | `GCSAR.Irrigation.Core.CropLibrary` + `CropParameters` | معاملات المحاصيل (Kc، Zr، p، h، Ky، حدود الأطوار بـ GDD) |
| `js/engine/soils.js` | `GCSAR.Irrigation.Core.SoilLibrary` | θFC وθWP وCN للقوامات، وكفاءات أنظمة الري |
| `js/engine/waterbalance.js` | `GCSAR.Irrigation.Core.WaterBalanceEngine` | الموازنة اليومية، وKs، والتوصية |
| `tools/nasa_power_sync.py` | `GCSAR.Irrigation.Data.NasaPowerService` (خدمة خلفية) | التنزيل والأرشفة؛ يبقى على GitHub Actions حتى في نسخة .NET |
| `js/balance-ui.js` وباقي `index.html` | Blazor pages / WPF views | واجهة فقط |
| `localStorage` + ملف JSON | SQLite / ملفات مشروع على الحاسب | الحفظ؛ نفس مخطط JSON |
| تصدير XLSX (SheetJS) | ClosedXML / EPPlus | استيراد وتصدير Excel |

## مخطط ملف الحقل (`gcsar.field/1`)
```json
{
  "schema": "gcsar.field/1",
  "name": "سلمية — قمح 2025/26",
  "areaDunum": 10,
  "location": { "lat": 35.01, "lon": 37.05, "climateSource": "أرشيف المنصة — NASA POWER" },
  "sowingDate": "2025-11-20", "endDate": "2026-06-10",
  "crop": { "key": "wheat", "kcIni": 0.7, "kcMid": 1.15, "kcEnd": 0.3, "h": 1.0, "zrMin": 0.2, "zrMax": 1.5, "p": 0.55,
            "ky": 1.05, "tbase": 0, "tupper": null, "gdd": { "iniEnd": 550, "devEnd": 1600, "midEnd": 2100, "lateEnd": 2600 } },
  "soil": { "texture": "siltLoam", "thetaFC": 0.29, "thetaWP": 0.15, "cn": 80, "initialDepletionFrac": 0.5, "subsoilDepletionFrac": 0.5 },
  "irrigation": { "system": "sprinkler", "mode": "scheduled", "efficiency": 0.75, "triggerFrac": null,
                  "events": [ { "date": "2026-03-15", "grossMm": 60 } ] }
}
```
`mode`: يأخذ إحدى ثلاث قيم: `scheduled` (ري تلقائي عند العتبة إضافة إلى الريات المسجلة)، `actual` (الريات المسجلة فقط)، `rainfed` (بعلي).
`triggerFrac = null` تعني أن العتبة هي RAW، أي p معدّل يومياً.

## سجل الطقس اليومي (مدخل المحرك)
| الحقل | الوحدة | المصدر |
|---|---|---|
| `date` | YYYY-MM-DD | — |
| `tmin`, `tmax` | °C | المحطة أو T2M_MIN/T2M_MAX |
| `et0` | mm/day | `Fao56.et0FromRecord` |
| `rain` | mm/day | المحطة أو PRECTOTCORR |
| `u2` | m/s | محسوبة عند ارتفاع 2 م (اختياري، لتعديل Kc) |
| `rhmin` | % | مقاسة، أو مقدّرة من Tdew وTmax (اختياري) |

## سجل الموازنة اليومية (مخرج المحرك) — `DailyBalance`
`Date, GDD, Stage, StageName, Kc, Zr, TAW, RAW, p, ET0, ETc, Ks, ETcAdj, P, RO, Inet, Igross, AutoIrrigation, DP, Recharge, Dr, Dsub, Trigger, NeedsIrrigation, MissingWeather`

الوحدات: mm، m، °C·day. وتُستخدم أسماء الحقول نفسها كخصائص لـ `record DailyBalance` في C#.

## الاتفاقيات العلمية المعلنة
1. **الهطول:** يُحسب كـ P − RO، والجريان RO بطريقة SCS-CN اليومية (AMC II). لا يُستخدم Peff بالتوازي معه، تفادياً للعد المزدوج.
2. **الفينولوجيا:** تعتمد على الزمن الحراري. حدود الأطوار الأربعة لـ FAO-56 مقاسة بـ GDD من تاريخ الزراعة، ومنحنى Kc وعمق الجذور يُستكملان خطياً على GDD.
3. **عمق الجذور المتزايد:** التربة تحت الجذور خزان ثانٍ له استنزاف خاص Dsub. عند تعمّق الجذور تدخل حصة الشريحة الجديدة من Dsub إلى Dr. والتسرب من منطقة الجذور يملأ Dsub أولاً، وما يفيض يخرج من القطاع.
4. **Ks:** يُحسب من Dr في بداية اليوم.
5. **Kc mid/end:** يُعدّلان بمتوسط u2 وRHmin خلال الطور المعني (Eq. 62). ولا يُعدّل Kc end إذا كان أقل من 0.45.
6. **p:** يُعدّل يومياً وفق p = p_tab + 0.04(5 − ETc)، ويُحصر بين 0.1 و0.8.
7. **الري التلقائي:** إذا بلغ Dr العتبة في نهاية يوم، يُضاف في اليوم التالي ري صافٍ يساوي Dr (تعبئة إلى السعة الحقلية)، ويُحسب الإجمالي بقسمته على Ea.
8. **نهاية الموسم:** تنتهي المحاكاة عند بلوغ GDD حد الحصاد.
9. **إغلاق الكتلة:** الملخص يتضمن `MassClosureMm`، ويجب أن يساوي صفراً.

## خطة مشروع .NET (المرحلة الأخيرة)
```
GCSAR.Irrigation.sln
 ├─ src/GCSAR.Irrigation.Core        ← المحرك (Fao56, CropLibrary, SoilLibrary, WaterBalanceEngine, Models)
 ├─ src/GCSAR.Irrigation.Data        ← Excel (ClosedXML)، قارئ أرشيف NASA (نفس JSON)، SQLite للحقول والمناخ المعتمد
 ├─ src/GCSAR.Irrigation.Desktop     ← واجهة حاسب (WPF أو Blazor Hybrid)
 └─ tests/GCSAR.Irrigation.Core.Tests ← xUnit يقرأ tests/vectors/*.json نفسها
```
**شرط القبول:** يجب أن تجتاز النسخة C# كل حالات `tests/vectors/` بالسماحيات نفسها، قبل أن تحل محل محرك JS في أي حساب.

## التشغيل والاختبار
- `node tests/run_engine_tests.js` لتشغيل اختبارات المحرك (Node دون أي مكتبات).
- `python tools/fao56.py` للتحقق من نسخة Python المستخدمة في المزامنة، على مثال FAO-56 رقم 18.
