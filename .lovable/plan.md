

## تحليل الملف المرفوع

الملف هو أداة HTML مستقلة لتعريب Luigi's Mansion 2 HD تحتوي على ميزات متقدمة غير موجودة في المشروع الحالي. بعد مقارنة شاملة، هذه هي الميزات القابلة للاستفادة:

### ما هو موجود حالياً في المشروع
- استخراج النصوص من .data/.dict (UTF-32-LE + NLOC)
- محرر ترجمة متقدم مع حماية الوسوم
- بناء ملفات النص بطريقة Buffer Expansion (حقن في الأوفست)

### ما هو موجود في الأداة المرفوعة وغير موجود في المشروع

| الميزة | الوصف |
|--------|-------|
| **محرر خطوط (Font Editor)** | فك DDS/DXT5 textures، عرض أطلس الخطوط، كشف تلقائي للحروف |
| **ترميز DXT5** | فك وإعادة ترميز صور DXT5 (ضغط نصوص الخطوط) |
| **توليد أطلس عربي** | رسم حروف عربية بأشكالها الأربعة على صفحات أطلس جديدة |
| **بناء NLOC كامل** | إعادة بناء هيكل NLOC بالكامل (Header + TOC + Strings) بدلاً من الحقن في المكان |
| **شبكة الأحرف العربية** | عرض كل أشكال الحروف العربية (معزول/بداية/وسط/نهاية) مع التشكيل |

---

## خطة التطوير

### الخطوة 1: إضافة مكتبة DXT5 Codec
إنشاء `src/lib/dxt5-codec.ts` — نقل دوال `decodeDXT5` و `encodeDXT5` و `encodeDXT5Block` من الأداة المرفوعة وتحويلها لـ TypeScript مع تصدير نظيف.

### الخطوة 2: إنشاء صفحة محرر الخطوط
إنشاء `src/pages/FontEditor.tsx` — صفحة جديدة تتضمن:
- رفع ملفات FEBundleFonts_res.data/.dict
- عرض أطلس الخطوط (Canvas) مع تكبير/تصغير
- كشف تلقائي للحروف (auto-detect glyphs)
- جدول الحروف المكتشفة مع تعديل/حذف
- رسم حروف عربية على الأطلس باستخدام خط TTF مخصص
- بناء وتحميل ملف الخط المعدل

### الخطوة 3: إضافة لوحة الأحرف العربية
إنشاء `src/components/editor/ArabicCharsPanel.tsx`:
- شبكة عرض جميع أشكال الحروف العربية (Presentation Forms)
- التشكيل (فتحة، ضمة، كسرة، شدة...)
- إعدادات حجم الخط واللون والإزاحة
- معاينة حية على Canvas

### الخطوة 4: تحسين بناء ملفات NLOC
تحديث `handleBuildNloc` في `src/hooks/useEditorBuild.ts`:
- اعتماد طريقة "إعادة البناء الكامل" من الأداة المرفوعة (Header + TOC + String Data)
- بدلاً من الحقن في الأوفست (الطريقة الحالية)، يتم بناء ملف NLOC جديد كلياً
- هذا يسمح بنصوص بأي طول بدون قيود

### الخطوة 5: ربط المسارات
تحديث `src/App.tsx` لإضافة مسار `/luigi-mansion/fonts` → FontEditor
تحديث `src/pages/LuigiMansion.tsx` لإضافة زر "محرر الخطوط"

---

### التفاصيل التقنية

```text
ملفات جديدة:
  src/lib/dxt5-codec.ts          — DXT5 decode/encode (من الأداة)
  src/lib/arabic-forms-data.ts   — بيانات أشكال الحروف العربية (ARABIC_LETTERS + TASHKEEL)
  src/pages/FontEditor.tsx       — صفحة محرر الخطوط الكاملة
  src/components/editor/ArabicCharsPanel.tsx — لوحة الأحرف العربية

ملفات معدّلة:
  src/App.tsx                    — إضافة مسار /luigi-mansion/fonts
  src/pages/LuigiMansion.tsx     — إضافة رابط محرر الخطوط
  src/hooks/useEditorBuild.ts    — تحسين بناء NLOC (Full Rebuild)

المنطق الرئيسي المنقول من الأداة:
  - findDDSPositions()     → مسح ملف .data للعثور على صفحات DDS
  - decodeDXT5/encodeDXT5  → فك/ضغط نصوص الأطلس
  - autoDetectGlyphs()     → كشف حدود الحروف بتحليل alpha channel
  - generateFullArabicAtlas() → رسم حروف عربية على صفحات جديدة
  - buildTextFile()        → بناء NLOC كامل (أفضل من الحقن الحالي)
```

