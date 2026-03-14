

## تحليلك صحيح 100% — مصدر الخطأ هو LZ4

بعد فحص الكود في `src/lib/unity-asset-bundle.ts` سطر 218:

```typescript
const written = lz4.compressBlock(input, output, 0, input.length, 0);
//                                                               ^^^
// المعامل الأخير = 0 (رقم بدائي)
// مكتبة lz4js تحاول: hashTable[45673] = value → CRASH في Strict Mode
```

هذا هو **بالضبط** مصدر `Cannot create property '45673' on number '0'`.

---

### خطة الإصلاح

#### 1. إصلاح LZ4 hashTable (الإصلاح الحرج)

**`src/lib/unity-asset-bundle.ts`** — سطر 218:

```typescript
// قبل:
const written = lz4.compressBlock(input, output, 0, input.length, 0);

// بعد:
const hashTable = new Uint32Array(65536);
const written = lz4.compressBlock(input, output, 0, input.length, hashTable);
```

نفس الإصلاح لـ `decompressBlock` سطر 234 (إن كان يستخدم نفس النمط).

#### 2. التأكد من أن سياسة الفشل الصارم تعمل بالمنطق الجديد

من التقرير الذي أرسلته، يظهر أن الكود القديم هو الذي يعمل (رسائل `⚠️` بدون تمييز بين `expected` و `applied`). الكود الجديد موجود بالفعل في المشروع ويميز بين:
- ملفات **لا توجد لها ترجمات أصلاً** → تمرير بصمت (`ℹ️`)
- ملفات **كان متوقعاً لها ترجمات ولم تُحقن** → إيقاف البناء (`❌`)

يجب التأكد من تحميل الإصدار الجديد (تحديث الصفحة).

### الملفات المتأثرة

| الملف | التغيير |
|---|---|
| `src/lib/unity-asset-bundle.ts` | تمرير `Uint32Array(65536)` بدلاً من `0` لـ hashTable |

