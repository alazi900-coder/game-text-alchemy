

## تقرير Manus: إصلاح المشكلتين الحرجتين

### المشكلة 1: بيانات زائدة في نهاية الملف (Trailing Zeros) — **مؤكدة 100%**

**السبب الجذري** في `src/lib/unity-asset-bundle.ts`:

```text
BinaryWriter.toUint8Array() → returns view: Uint8Array(buf.buffer, 0, pos)
                                              ↓
repackBundle() line 640: buffer: result.buffer ← هذا يعيد الـ ArrayBuffer الكامل!
                                                  (مثلاً 65536 بايت بدل 16897)
```

`toUint8Array()` يُرجع **view** على الـ buffer الأصلي. عند استخدام `.buffer` نحصل على **كامل** الـ ArrayBuffer المخصص (الذي يتضاعف تلقائياً عند الحاجة)، وليس فقط البايتات المكتوبة فعلياً. هذا يضيف آلاف البايتات الصفرية الزائدة.

**الإصلاح**: سطر واحد — نسخ البايتات المكتوبة فقط بدل إرجاع view:

```typescript
// قبل:
toUint8Array(): Uint8Array { return new Uint8Array(this.buf.buffer, 0, this.pos); }

// بعد:
toUint8Array(): Uint8Array { return this.buf.slice(0, this.pos); }
```

`.slice()` يُنشئ ArrayBuffer جديد بالحجم الصحيح تماماً.

---

### المشكلة 2: الترجمات لا تُحقن (النصوص تبقى إنجليزية)

**السبب**: في البناء (سطر 410)، يبحث عن الترجمات باستخدام `keyByMsbtNameAndIndex.get(fileName)` حيث `fileName` هو الاسم من IDB (مثل `bundle__accessories__entry_0.msbt`). لكن `extractMsbtFileName` يستخرج الاسم **الكامل** بما فيه البادئة scoped. المشكلة أن المقارنة تتم بين أسماء مختلفة الصيغة.

عندما يمر البناء على كل ملف MSBT، يبحث في `keyByMsbtNameAndIndex` بالاسم المستخرج من `extractMsbtFileName`، لكن هذا الاسم لا يتطابق دائماً مع الاسم المخزن في IDB كـ `msbtFileNames`.

**الإصلاح**: توحيد البحث عبر `extractShortMsbtName` (من المحرك المركزي) لمطابقة المفاتيح بالاسم القصير عند فشل المطابقة المباشرة.

---

### الملفات والتغييرات

**`src/lib/unity-asset-bundle.ts`**:
- إصلاح `BinaryWriter.toUint8Array()` ليستخدم `.slice()` بدل view
- هذا يحل مشكلة الـ Trailing Zeros مباشرة

**`src/hooks/useEditorBuild.ts`**:
- إصلاح بحث الترجمات في `handleBuildXenoblade` ليستخدم fallback بالاسم القصير عند فشل المطابقة المباشرة
- إضافة log تحذيري عندما لا يتم حقن أي ترجمة في ملف

