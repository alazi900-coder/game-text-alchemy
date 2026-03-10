

## المشكلة

عملية البناء لملفات Animal Crossing (SARC.ZS) تفشل في الحفاظ على الترجمات. السبب الجذري:

1. **دالة `handleBuildXenoblade` ترسل ملفات MSBT إلى خدمة `arabize-xenoblade` غير موجودة** — هذه الخدمة لم تُنشأ أبداً. فقط `arabize` موجودة وهي مصممة لملفات Zelda (تتطلب langFile + dictFile)

2. **عدم توافق صيغة الوسوم**: الاستخراج من جانب العميل يحول وسوم MSBT الثنائية (0x0E) إلى نص `[MSBT:Ruby]`، لكن دالة إعادة البناء `rebuildMsbt` تحول النص بـ `encodeUtf16` بدون معالجة هذه الوسوم — فتصبح نصاً حرفياً بدل وسوم ثنائية

## الحل: بناء SARC.ZS بالكامل من جانب العميل

### 1. تحسين `src/lib/msbt-parser.ts`

إضافة دالة `encodeUtf16WithTags` تقوم بـ:
- استخراج بايتات الوسوم الأصلية من `rawBytes` الخاصة بكل نص (فحص 0x0E و 0x0F)
- عند ترميز النص المترجم، استبدال كل `[MSBT:...]` و `[/MSBT:...]` ببايتات الوسم الأصلية بالترتيب
- ترميز باقي النص كـ UTF-16LE عادي

تعديل `rebuildMsbt` لاستخدام هذه الدالة بدلاً من `encodeUtf16` البسيطة

### 2. إعادة كتابة مسار البناء في `src/hooks/useEditorBuild.ts`

استبدال استدعاء `arabize-xenoblade` بمعالجة محلية بالكامل:

```text
لكل ملف MSBT في editorMsbtFiles:
  1. parseMsbtFile(data)
  2. تجميع الترجمات بصيغة {label → text}
     (تحويل من "msbt:filename:label:index" → label)
  3. تطبيق المعالجة العربية (reshaping + BiDi) على الترجمات
  4. إصلاح الوسوم التالفة (restoreTagsLocally)
  5. rebuildMsbt(msbt, translations) → Uint8Array معدّل
  
لكل أرشيف SARC:
  1. تجميع ملفات MSBT المعدلة + الملفات غير النصية
  2. buildSarcZs(entries, endian) → ملف مضغوط
  
تحميل الملف النهائي
```

### 3. ربط صيغة المفاتيح

المفاتيح في المحرر: `msbt:filename.msbt:labelName:0`
المفاتيح المطلوبة لـ `rebuildMsbt`: `labelName`

إضافة منطق تحويل المفاتيح لربط كل MSBT مع ترجماته الصحيحة

### النتيجة
- بناء سريع بالكامل محلياً بدون أي استدعاء لخدمات خارجية
- الترجمات تُحفظ بشكل صحيح في الملفات الثنائية
- وسوم MSBT تُحافظ عليها بالكامل

