

## المشكلة

في سطر 1400 من `useEditorBuild.ts`:

```typescript
const text = currentState.translations[key]?.trim() || entry.original;
```

هذا السطر يأخذ النص الأصلي كبديل دائماً إذا لم توجد ترجمة — أي أن **كل ملف** يُعتبر "مترجم" حتى لو لم يُعدّل حرف واحد فيه. النتيجة: يتم بناء **جميع الملفات** في الـ ZIP حتى غير المترجمة.

بالإضافة لذلك، في وضع TXT (سطر 1415-1419)، حتى لو لم تكن هناك ترجمات لملف معين، يتم تضمينه كنسخة أصلية في الـ ZIP:

```typescript
if (!fileTrans) {
  zip.file(`${rawFile.name}.txt`, rawFile.rawLines.join("\n"));
  builtCount++;
  continue;
}
```

## الحل

تعديل `handleBuildCobaltAs` في `src/hooks/useEditorBuild.ts`:

1. **فلترة الترجمات الفعلية فقط**: عند بناء `translationsByFileLabel`، إضافة النص فقط إذا اختلف عن النص الأصلي (`entry.original`)
2. **تخطي الملفات غير المعدّلة**: في وضع TXT، عدم تضمين الملفات التي ليس لها ترجمات فعلية (بدل تضمينها كنسخة أصلية). نفس الشيء في وضع MSBT
3. **تحديث عداد الملفات**: عرض عدد الملفات المعدّلة فعلياً فقط

### التغييرات التقنية

**ملف: `src/hooks/useEditorBuild.ts`**

- سطر ~1400: تغيير الشرط ليتحقق من وجود ترجمة فعلية مختلفة عن الأصل:
  ```typescript
  const translated = currentState.translations[key]?.trim();
  if (!translated || translated === entry.original) continue; // skip unchanged
  if (!translationsByFileLabel.has(fileName)) translationsByFileLabel.set(fileName, new Map());
  translationsByFileLabel.get(fileName)!.set(label, translated);
  ```

- سطر ~1415-1419 (وضع TXT): تخطي الملفات بدون ترجمات بدل تضمينها:
  ```typescript
  if (!fileTrans || fileTrans.size === 0) continue; // skip unmodified files
  ```

- سطر ~1462 (وضع TXT الاحتياطي): نفس الفلترة — تخطي المدخلات غير المترجمة
- سطر ~1488 (وضع MSBT): نفس الفلترة — تخطي المدخلات غير المترجمة

هذا سيضمن أن الملفات المُعرّبة فعلياً فقط تظهر في ملف ZIP الناتج، مما يقلل حجم المود ويمنع الكراش الناتج عن ملفات أصلية أُعيد بناؤها بدون داعٍ.

