
الخطأ مفهوم، ومحق في غضبك. الخطة هنا ستكون إصلاح جذري يمنع رجوع الخطأ نهائياً بدل ترقيع سطحي.

### التشخيص المرجّح
الرسالة:
`Cannot create property '45673' on number '0'`
تعني أن الكود يحاول الكتابة بهذا الشكل:
`something['45673'] = ...`
لكن `something` صار رقمًا `0` بدل كائن.

هذا يحدث غالبًا من بيانات مخزنة/مستوردة تالفة (IndexedDB أو localStorage أو JSON) ثم تُستخدم لاحقًا كـ object.

### خطة التنفيذ (تنفيذ فعلي بعد الموافقة)
1) **إضافة طبقة Sanitizer موحّدة للـ maps**
- إنشاء helper آمن داخل `useEditorState.ts` و `useEditorBuild.ts`:
  - يقبل أي قيمة.
  - يرجّع `Record<string,string>` فقط.
  - إذا القيمة ليست object (مثل `0`) يرجّع `{}` مع log واضح.

2) **تطبيق sanitizer على كل مداخل البيانات قبل أي merge أو mutation**
- `src/hooks/useEditorState.ts`
  - عند تحميل `editorState` من IDB.
  - عند `handleCloudLoad`.
  - قبل أي `setState` يدمج `translations`.
- `src/hooks/useEditorBuild.ts`
  - قبل `Object.entries(currentState.translations)`.
  - قبل أي سطر من نوع `translationsMap[key] = ...`.

3) **إصلاح مصدر محتمل قوي للخطأ في history**
- `src/components/editor/TranslationToolsPanel.tsx`
  - `loadHistory()` لن يرجع parsed value مباشرة.
  - يتحقق أن القيمة object فعلًا، وإلا يعيد `{}`.
  - `addToHistory()` يُغلّف الكتابة بحماية إضافية حتى لو localStorage يحتوي `"0"`.

4) **Self-healing تلقائي للبيانات التالفة**
- عند بدء المحرر:
  - إذا وُجد `translations` أو `translation-history-v1` بصيغة خاطئة → يُعاد تصفيرها الآمن تلقائيًا.
  - رسالة واضحة للمستخدم: تم إصلاح بيانات جلسة تالفة تلقائيًا.

5) **تحسين التشخيص داخل واجهة سجل البناء**
- في `useEditorBuild.ts`:
  - تسجيل اسم المرحلة (normalize / inject / repack / export).
  - إظهار stack trace في `lastBuildLog` عند الفشل.
- في `BuildVerificationDialog.tsx`:
  - عرض سطر “المرحلة التي فشلت” لتحديد السبب فورًا.

### التحقق بعد التنفيذ
- اختبار حالة فساد متعمّد: تخزين `"0"` بدل object في مفاتيح التخزين ثم تشغيل البناء.
- التأكد أن:
  - لا يظهر TypeError.
  - يتم self-heal تلقائياً.
  - البناء يكمل أو يفشل برسالة مفهومة مع مرحلة الخطأ.

### تفاصيل تقنية مختصرة
- سبب هذا النوع من الأخطاء دائمًا “shape mismatch” (number بدل object).
- الإصلاح الحقيقي = **Guard at boundaries + Sanitization before mutation + Self-healing**.
- بهذا الشكل حتى لو دخلت بيانات تالفة مستقبلًا، التطبيق لن ينهار بنفس الخطأ.
