

## خطة شاملة: إصلاح خطأ Cannot create property + التحقق الثنائي + سياسة الفشل الصارم

### التشخيص النهائي لخطأ `Cannot create property '45673' on number '0'`

بعد فحص كل مسار في الكود، المشكلة ليست في `translations` الرئيسي (تم حمايته)، بل في **مسارات أخرى لم تُحمَ**:

1. **`useEditorState.ts`** - دوال الفحص والتعديل الجماعي (مثل `handleClearTranslations`, `handleApplyEnhance`, `handleApplyAutoCorrect`) تقوم بـ:
   ```
   const newTranslations = { ...state.translations };
   newTranslations[key] = value;  // ← إذا state.translations كان 0
   ```
   الـ spread operator `{ ...0 }` = `{}` فلا مشكلة هنا.

2. **المصدر المرجّح الفعلي**: الخطأ يحدث في أحد المسارات التالية التي لا تمر عبر sanitizer:
   - `useEditorTranslation.ts` سطر 234-241: `tmMap` يُبنى من `state.translations` مباشرة
   - `useEditorQuality.ts` سطر 97: `state.translations[key]` يُقرأ مباشرة
   - **الأرجح**: مكون `EntryCard` أو `VirtualizedEntryList` يحاول الكتابة على `state.translations` مباشرة عبر `onApplyTranslation`

   لكن الخطأ يحتوي `'45673'` كمفتاح — وهذا رقم كبير جداً يُشبه فهرس entry. هذا يعني أن الخطأ يحدث في حلقة تُعالج عشرات الآلاف من المدخلات.

3. **المصدر الأكيد**: في `useEditorState.ts` عند تطبيق نتائج المراجعة أو التصحيح الجماعي، هناك أسطر مثل:
   ```typescript
   const newTranslations = { ...state.translations };
   for (const item of pending) {
     newTranslations[item.key] = item.after;  // ← CRASH if state.translations somehow became 0
   }
   ```
   إذا كان `state.translations` هو `0` لحظة القراءة (race condition أو corrupted IDB)، فإن `{ ...0 }` يعطي `{}` — لكن **إذا تم تخزين `0` في `state` نفسه ثم مُرر كـ prop بدون spread**، أي مكوّن يحاول `translations[key] = value` سينهار.

### خطة التنفيذ

#### 1. حماية شاملة لـ `state.translations` (إصلاح الخطأ نهائياً)

**`src/hooks/useEditorState.ts`**:
- تعديل `setState` ليكون wrapper يفحص `translations` تلقائياً عند كل تحديث:
  ```typescript
  const safeSetState = (updater) => {
    rawSetState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next && typeof next.translations !== 'object') {
        console.error('[STATE-GUARD] translations corrupted to:', typeof next.translations);
        return { ...next, translations: {} };
      }
      return next;
    });
  };
  ```
- هذا يضمن أن `state.translations` **مستحيل** أن يصبح رقماً أو null.

#### 2. سياسة الفشل الصارم 100% عند البناء

**`src/hooks/useEditorBuild.ts`** - في `handleBuildXenoblade`:
- بعد حلقة MSBT rebuild (سطر ~582)، إضافة فحص صارم:
  ```
  if (filesWithNoMatch > 0) {
    // إيقاف البناء + عرض تقرير مفصّل بالملفات غير المطابقة
    log('[BUILD] ❌ STRICT: فشل البناء — ملفات بدون ترجمات');
    setBuildProgress('❌ فشل البناء...');
    // عرض نافذة التحقق مع تفاصيل الفشل
    setBuildVerification(failResult);
    setShowBuildVerification(true);
    setBuilding(false);
    return;
  }
  ```
- تسجيل تفاصيل كل ملف: عدد المدخلات، عدد المطابقات، نسبة التغطية.

#### 3. فاحص ثنائي مدمج بعد البناء (Binary Validator)

**ملف جديد: `src/lib/bundle-validator.ts`**:
- دالة `validateBundle(buffer: ArrayBuffer)` تفحص:
  1. **UnityFS Header Size**: مطابقة الحجم المصرح في الترويسة (bytes 24-31) مع حجم الملف الفعلي
  2. **MSBT BOM**: التحقق من `0xFEFF` أو `0xFFFE`
  3. **TXT2 Size**: مطابقة حجم القسم المصرح مع البيانات الفعلية
  4. **Null Terminators**: كل نص ينتهي بـ `0x00 0x00`
  5. **Control Tags**: وجود `0x0E`/`0x0F` كبايتات ثنائية وليس نصوص
  6. **وجود نصوص عربية**: البحث عن نطاقات Unicode العربية في TXT2
- ترجع مصفوفة نتائج `{ check, status, detail }[]`

**`src/hooks/useEditorBuild.ts`**:
- بعد `repackBundle()` وقبل التنزيل:
  ```
  const validation = validateBundle(result.buffer);
  const hasCritical = validation.some(v => v.status === 'fail');
  if (hasCritical) {
    // منع التنزيل + عرض التقرير
  }
  ```

**`src/components/editor/BuildVerificationDialog.tsx`**:
- إضافة قسم "الفحص الثنائي" يعرض نتائج الفاحص بنفس التنسيق اللوني الحالي

#### 4. إصلاح Trailing Zeros (تأكيد إضافي)

**`src/lib/unity-asset-bundle.ts`**:
- بعد `repackBundle` يُرجع النتيجة، إضافة assertion:
  ```typescript
  // Double-check: declared size must equal actual buffer size
  const declaredSize = Number(BigInt(...));
  if (result.buffer.byteLength !== declaredSize) {
    throw new Error(`Size mismatch: declared=${declaredSize}, actual=${result.buffer.byteLength}`);
  }
  ```

### الملفات المتأثرة

| الملف | التغيير |
|---|---|
| `src/hooks/useEditorState.ts` | حماية setState من translations تالف |
| `src/hooks/useEditorBuild.ts` | سياسة فشل صارم + تكامل الفاحص الثنائي |
| `src/lib/bundle-validator.ts` | **جديد** — فاحص ثنائي شامل |
| `src/lib/unity-asset-bundle.ts` | assertion لحجم الملف |
| `src/components/editor/BuildVerificationDialog.tsx` | عرض نتائج الفحص الثنائي |

