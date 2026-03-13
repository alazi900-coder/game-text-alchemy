

## عرض سجل البناء في واجهة المستخدم

السجل المفصّل موجود حالياً ويُحفظ في IndexedDB تحت المفتاح `lastBuildLog`، لكنه لا يظهر إلا في Console. الخطة: إضافة عرض السجل مباشرة في نافذة تقرير التحقق بعد البناء.

### التعديلات

**1. تحديث `BuildVerificationDialog.tsx`**
- إضافة prop جديد `buildLog: string[]` للسجل
- إضافة زر "عرض السجل" أسفل التقرير يفتح/يغلق قسم السجل (collapsible)
- عرض السجل في `ScrollArea` بخط monospace مع تلوين الأسطر (أخضر للنجاح ✅، أحمر للأخطاء ❌، أصفر للتحذيرات ⚠️)
- إضافة زر "نسخ السجل" لنسخه للحافظة

**2. تحديث `useEditorBuild.ts`**
- إضافة state جديد `buildLog` من نوع `string[]`
- حفظ السجل في الـ state بعد البناء (بالإضافة لحفظه في IDB)
- تصدير `buildLog` ضمن القيم المُرجعة

**3. تحديث `useEditorState.ts` و `Editor.tsx`**
- تمرير `buildLog` من الـ hook إلى `BuildVerificationDialog`

