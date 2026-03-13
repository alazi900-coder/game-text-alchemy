

## المشكلة: الحجم الكبير للملف الناتج (16KB → 56KB)

**السبب الجذري**: دالة `repackBundle` في `src/lib/unity-asset-bundle.ts` تكتب الملف الناتج بدون ضغط (flags = 0)، بينما الملف الأصلي مضغوط بـ LZ4. هذا يجعل الملف الناتج أكبر بـ 3-4 مرات من الأصلي.

**السطر المسؤول** (سطر 625):
```typescript
w.writeU32(0); // flags: no compression, inline  ← هنا المشكلة
```

---

## خطة الإصلاح

### 1. إضافة ضغط LZ4 لكتل البيانات في `repackBundle`

في `src/lib/unity-asset-bundle.ts`:
- بعد تجميع `newDecompressed`، نضغطه بـ LZ4 باستخدام `lz4.compressBlock` (المكتبة موجودة ومستوردة أصلاً)
- نكتب في الترويسة: `compressedBlockInfoSize` و `decompressedBlockInfoSize` الصحيحة
- نغير flags إلى `COMPRESSION_LZ4` (2) للكتل
- نحافظ على Block Info بدون ضغط (flags الرئيسية = 0) لكن كتل البيانات تكون LZ4

### 2. إضافة ضغط LZ4 لكتلة Block Info

- Block Info نفسها تُضغط بـ LZ4 أيضاً حسب الأصلي (نستخدم `originalCompressionType` من `info.flags`)

### 3. الحفاظ على نوع الضغط الأصلي

- نقرأ `info.flags & 0x3F` لمعرفة نوع ضغط الأصلي
- إذا كان LZ4 نضغط بـ LZ4، إذا كان بدون ضغط نبقيه بدون ضغط
- Zstd نتركه uncompressed (لأن lz4 library لا تدعم ضغط zstd والمكتبة الحالية تدعم فك فقط)

### الملفات المتأثرة
- `src/lib/unity-asset-bundle.ts` — إضافة دالة `compressBlockLz4` واستخدامها في `repackBundle`

