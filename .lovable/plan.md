

## خطة: تدفق موحّد لـ Fire Emblem مثل Animal Crossing

### المشكلة الحالية
Fire Emblem يتطلب 3 خطوات منفصلة:
1. فاك Bundle في صفحة منفصلة → تحميل ملفات MSBT
2. رفع MSBT في صفحة المعالجة → ترجمة في المحرر
3. العودة لصفحة فاك Bundle → رفع MSBT المترجمة → إعادة الحزم

هذا معقد ويفشل. المطلوب: رفع `.bytes.bundle` مباشرة → ترجمة → بناء bundle جاهز.

### الحل

#### 1. دعم ملفات .bundle في `MsbtProcess.tsx`
- إضافة `.bundle` و `.bytes` لقائمة الامتدادات المقبولة في input file
- في `handleFileSelect`: إذا كان الملف ينتهي بـ `.bundle` أو `.bytes.bundle`:
  - استدعاء `extractBundleAssets()` من `unity-asset-bundle.ts`
  - استخراج MSBT من الـ assets
  - تخزين معلومات Bundle في IDB (`editorBundleInfo`) تشمل: اسم الملف الأصلي، `info`، `decompressedData`، `assets`، `originalBuffer`
  - إضافة ملفات MSBT المستخرجة لقائمة `msbtFiles` كالمعتاد

#### 2. تخزين بيانات Bundle في IndexedDB
مفاتيح جديدة:
- `editorBundleMeta`: مصفوفة من `{ originalFileName, info, assets, decompressedData, originalBuffer }`
- يتم مسحها مع باقي البيانات عند بدء جلسة جديدة

#### 3. إعادة بناء Bundle عند البناء (`useEditorBuild.ts`)
في `handleBuildXenoblade`:
- بعد بناء ملفات MSBT المترجمة، التحقق من وجود `editorBundleMeta` في IDB
- إذا وُجد: استخدام `repackBundle()` لاستبدال ملفات MSBT المترجمة داخل الـ bundle الأصلي
- تحميل ملف `.bundle` النهائي مباشرة (أو ZIP إذا كان أكثر من bundle)

#### 4. تحديث صفحة FireEmblem.tsx
- تغيير زر "ابدأ التعريب" للإشارة لدعم رفع `.bundle` مباشرة
- إزالة أو تقليل أهمية زر "فاك ملفات Bundle" (يبقى كأداة متقدمة)

#### 5. تنظيف الجلسة
- إضافة `editorBundleMeta` لقائمة المفاتيح الممسوحة في `handleFileSelect` و `handleStartFresh`

### الملفات المتأثرة
- `src/pages/MsbtProcess.tsx` — دعم `.bundle` في الرفع والاستخراج
- `src/hooks/useEditorBuild.ts` — إعادة حزم Bundle عند البناء
- `src/hooks/useEditorState.ts` — مسح `editorBundleMeta` عند البدء من جديد
- `src/pages/FireEmblem.tsx` — تحديث التعليمات والأزرار

### التدفق النهائي
```text
رفع .bytes.bundle ──► استخراج MSBT تلقائياً ──► المحرر ──► ترجمة ──► بناء ──► تحميل .bundle معرّب
```
مطابق تماماً لتدفق Animal Crossing مع SARC.ZS.

