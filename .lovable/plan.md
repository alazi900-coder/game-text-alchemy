

## التشخيص — سبب جذري واحد يفسر كل شيء

### المشكلة

في سطر 597-598 من `useEditorBuild.ts`:

```typescript
if (applied > 0) {
  rebuiltMsbtFiles[fileName] = rebuildMsbt(msbt, translationsForFile);
} else {
  rebuiltMsbtFiles[fileName] = new Uint8Array(buf);  // ← هذا هو المصدر
}
```

**كل ملف MSBT — حتى الذي ليس فيه أي ترجمة — يُضاف إلى `rebuiltMsbtFiles`**. بعدها في حلقة إعادة بناء الـ Bundles:

```typescript
const rebuiltData = rebuiltMsbtFiles[lookupName];
if (rebuiltData) {
  replacements.set(makeAssetReplacementKey(asset), rebuiltData);
}
```

النتيجة: **كل bundle يُعاد بناؤه بالكامل** (295 ملف!) حتى لو لم يكن فيه أي تغيير. والأسوأ: عملية إعادة البناء تُفسد البنية (Trailing Zeros) لأن LZ4 recompression + header reconstruction لا تطابق الأصل بالضبط.

هذا يفسر تقرير Manus: ملف `r_alfred_etie` ليس فيه أي ترجمة، لكنه أُعيد بناؤه وخرج بحجم خاطئ.

---

### خطة الإصلاح

#### 1. عدم إعادة بناء الملفات التي ليس فيها ترجمات

**`src/hooks/useEditorBuild.ts`** — سطر 595-599:

```typescript
// قبل:
if (applied > 0) {
  rebuiltMsbtFiles[fileName] = rebuildMsbt(msbt, translationsForFile);
} else {
  rebuiltMsbtFiles[fileName] = new Uint8Array(buf);  // حذف هذا السطر
}

// بعد:
if (applied > 0) {
  rebuiltMsbtFiles[fileName] = rebuildMsbt(msbt, translationsForFile);
}
// الملفات بدون ترجمات لا تُضاف — تبقى كما هي في الـ bundle الأصلي
```

هذا يعني أن الـ bundles التي ليس فيها ترجمات **لن تُعاد حزمها أبداً** — سيُرجع `repackBundle` الملف الأصلي بدون تعديل (سطر 618-625 الموجود فعلاً).

#### 2. إصلاح `areBytesEqual` للتعامل مع بيانات IDB

**`src/lib/unity-asset-bundle.ts`** — دالة `areBytesEqual`:

```typescript
// بعد:
function areBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;  // length بدل byteLength
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

#### 3. حفظ نوع الضغط الأصلي (LZ4HC → LZ4HC)

في `repackBundle`، بدلاً من تحويل LZ4HC إلى LZ4:

```typescript
// الحفاظ على نفس نوع الضغط الأصلي في الأعلام
const preferredDataCompression = originalBlockCompression; // لا نُغيّر
```

---

### الملفات المتأثرة

| الملف | التغيير |
|---|---|
| `src/hooks/useEditorBuild.ts` | حذف سطر 598 (لا نُضيف ملفات بدون ترجمات) |
| `src/lib/unity-asset-bundle.ts` | إصلاح `areBytesEqual` + حفظ compression flag الأصلي |

### النتيجة المتوقعة

- **~85 ملف فقط** يُعاد بناؤها (التي فيها ترجمات فعلاً) بدلاً من 295
- **~210 ملف** تبقى أصلية بدون أي تعديل
- لا مزيد من Trailing Zeros في الملفات غير المترجمة
- حجم ZIP أصغر بكثير

