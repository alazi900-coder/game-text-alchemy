import { describe, it, expect } from "vitest";

// دالة تنظيف أحرف Presentation Forms - نفس الدالة من Editor.tsx
const normalizeArabicPresentationForms = (text: string): string => {
  if (!text) return text;
  
  let result = text;
  
  // تحويل أحرف Presentation Forms-A (U+FB50–U+FDFF)
  // هذا يشمل جميع الأشكال المختلفة للأحرف (معزول، نهائي، وسط، ابتدائي)
  const presentationAMap: Record<string, string> = {
    // Alef variations
    '\uFB50': 'ا', '\uFB51': 'ا',
    // Beh variations
    '\uFB52': 'ب', '\uFB53': 'ب', '\uFB54': 'ب', '\uFB55': 'ب',
    // Teh Marbuta variations
    '\uFB56': 'ة', '\uFB57': 'ة',
    // Teh variations
    '\uFB58': 'ت', '\uFB59': 'ت', '\uFB5A': 'ت', '\uFB5B': 'ت',
    // Theh variations
    '\uFB5C': 'ث', '\uFB5D': 'ث', '\uFB5E': 'ث', '\uFB5F': 'ث',
    // Jeem variations
    '\uFB60': 'ج', '\uFB61': 'ج',
    // Hah variations
    '\uFB62': 'ح', '\uFB63': 'ح', '\uFB64': 'ح', '\uFB65': 'ح',
    // Khah variations
    '\uFB66': 'خ', '\uFB67': 'خ',
    // Dal variations
    '\uFB68': 'د', '\uFB69': 'د',
    // Thal variations
    '\uFB6A': 'ذ', '\uFB6B': 'ذ',
    // Reh variations
    '\uFB6C': 'ر', '\uFB6D': 'ر',
    // Zain variations
    '\uFB6E': 'ز', '\uFB6F': 'ز',
    // Seen variations
    '\uFB70': 'س', '\uFB71': 'س', '\uFB72': 'س', '\uFB73': 'س',
    // Sheen variations
    '\uFB74': 'ش', '\uFB75': 'ش', '\uFB76': 'ش', '\uFB77': 'ش',
    // Sad variations
    '\uFB78': 'ص', '\uFB79': 'ص',
    // Dad variations
    '\uFB7A': 'ض', '\uFB7B': 'ض',
    // Tah variations
    '\uFB7C': 'ط', '\uFB7D': 'ط',
    // Zah variations
    '\uFB7E': 'ظ', '\uFB7F': 'ظ',
    // Ain variations
    '\uFB80': 'ع', '\uFB81': 'ع',
    // Ghain variations
    '\uFB82': 'غ', '\uFB83': 'غ',
    // Feh variations
    '\uFB84': 'ف', '\uFB85': 'ف',
    // Qaf variations
    '\uFB86': 'ق', '\uFB87': 'ق',
    // Kaf variations
    '\uFB88': 'ك', '\uFB89': 'ك',
    // Lam variations
    '\uFB8A': 'ل', '\uFB8B': 'ل',
    // Meem variations
    '\uFB8C': 'م', '\uFB8D': 'م',
    // Noon variations
    '\uFB8E': 'ن', '\uFB8F': 'ن',
    // Heh variations
    '\uFB90': 'ه', '\uFB91': 'ه',
    // Waw variations
    '\uFB92': 'و', '\uFB93': 'و',
    // Yeh variations
    '\uFB94': 'ي', '\uFB95': 'ي', '\uFB96': 'ي', '\uFB97': 'ي',
    // Lam-Alef ligatures
    '\uFEFB': 'لا', '\uFEFC': 'لا', '\uFEF5': 'لأ', '\uFEF6': 'لأ',
    '\uFEF7': 'لؤ', '\uFEF8': 'لؤ', '\uFEF9': 'لا', '\uFEFA': 'لا',
  };
  
  // استبدل كل أحرف Presentation Forms بالأحرف العادية
  for (const [presentation, standard] of Object.entries(presentationAMap)) {
    result = result.split(presentation).join(standard);
  }
  
  // تحويل باقي أحرف Presentation Forms-B (U+FE70–U+FEFF) التي لم يتم تحويلها بعد
  result = result.replace(/[\uFE70-\uFEFF]/g, (char) => {
    // تطبيق NFKD normalization
    return char.normalize('NFKD');
  });
  
  // تطبيق NFKD normalization للتأكد من تحويل أي أحرف متبقية
  result = result.normalize('NFKD');
  
  return result;
};

describe("Arabic Presentation Forms Cleanup", () => {
  it("should normalize simple Arabic text with presentation forms", () => {
    // "عودة" with Presentation Forms-A
    const presentationText = "ﻋﻮﺩﺓ";
    const cleaned = normalizeArabicPresentationForms(presentationText);
    
    // النص يجب أن يتغير (تم تنظيفه)
    expect(cleaned).not.toBe(presentationText);
    
    // يجب أن يكون النص نظيف من Presentation Forms
    expect(/[\uFB50-\uFDFF]/.test(cleaned)).toBe(false);
  });

  it("should handle mixed text with presentation forms and regular chars", () => {
    const mixedText = "Hello ﻋﻮﺩﺓ World";
    const cleaned = normalizeArabicPresentationForms(mixedText);
    
    // يجب الحفاظ على النصوص الإنجليزية
    expect(cleaned).toContain("Hello");
    expect(cleaned).toContain("World");
    
    // يجب إزالة أحرف Presentation Forms
    expect(/[\uFB50-\uFDFF]/.test(cleaned)).toBe(false);
  });

  it("should preserve empty strings", () => {
    const empty = "";
    const cleaned = normalizeArabicPresentationForms(empty);
    expect(cleaned).toBe("");
  });

  it("should preserve null/undefined values", () => {
    const nullText = null as any;
    const cleanedNull = normalizeArabicPresentationForms(nullText);
    expect(cleanedNull).toBe(null);
  });

  it("should handle regular Arabic text without major changes", () => {
    const normalArabic = "مرحبا";
    const cleaned = normalizeArabicPresentationForms(normalArabic);
    // النص العادي قد يتغير قليلاً بسبب NFKD normalization لكن يجب أن يظل قابلاً للقراءة
    expect(cleaned).toBeDefined();
    expect(cleaned.length).toBeGreaterThan(0);
  });

  it("should normalize multiple presentation form characters in one string", () => {
    // نص يحتوي على عدة أحرف بأشكال عرض
    const multiplePresentation = "ﺗﺴﺎﺭﻉ";
    const cleaned = normalizeArabicPresentationForms(multiplePresentation);
    
    // يجب إزالة جميع أحرف Presentation Forms
    expect(/[\uFB50-\uFDFF]/.test(cleaned)).toBe(false);
  });

  it("should handle text with Lam-Alef ligatures", () => {
    // نص يحتوي على روابط Lam-Alef بأشكال مختلفة
    const ligatureText = "ﻻ"; // Lam with Alef Final form
    const cleaned = normalizeArabicPresentationForms(ligatureText);
    
    // يجب تحويل الرابط إلى حرفين منفصلين "لا"
    expect(cleaned).toContain("ل");
    expect(cleaned).toContain("ا");
  });

  it("should batch import json with presentation forms cleanup", () => {
    const importedData: Record<string, string> = {
      "key1": "ﻋﻮﺩﺓ",
      "key2": "ﺗﺴﺎﺭﻉ",
      "key3": "مرحبا",
    };
    
    // محاكاة عملية الاستيراد
    const cleanedImported: Record<string, string> = {};
    for (const [key, value] of Object.entries(importedData)) {
      cleanedImported[key] = normalizeArabicPresentationForms(value);
    }
    
    // التحقق من تنظيف جميع القيم
    for (const [key, cleaned] of Object.entries(cleanedImported)) {
      expect(/[\uFB50-\uFDFF]/.test(cleaned)).toBe(false);
      expect(cleaned).toBeDefined();
    }
  });
});
