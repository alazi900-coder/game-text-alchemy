/**
 * Arabic letter presentation forms data for font atlas generation.
 * Each letter has up to 4 contextual forms: isolated, final, initial, medial.
 */

export interface ArabicLetterForm {
  name: string;
  base: string;
  isolated: string | null;
  final: string | null;
  initial: string | null;
  medial: string | null;
}

export interface TashkeelMark {
  name: string;
  char: string;
  code: number;
}

export const ARABIC_LETTERS: ArabicLetterForm[] = [
  { name: 'ألف', base: 'ا', isolated: '\uFE8D', final: '\uFE8E', initial: null, medial: null },
  { name: 'باء', base: 'ب', isolated: '\uFE8F', final: '\uFE90', initial: '\uFE91', medial: '\uFE92' },
  { name: 'تاء', base: 'ت', isolated: '\uFE95', final: '\uFE96', initial: '\uFE97', medial: '\uFE98' },
  { name: 'ثاء', base: 'ث', isolated: '\uFE99', final: '\uFE9A', initial: '\uFE9B', medial: '\uFE9C' },
  { name: 'جيم', base: 'ج', isolated: '\uFE9D', final: '\uFE9E', initial: '\uFE9F', medial: '\uFEA0' },
  { name: 'حاء', base: 'ح', isolated: '\uFEA1', final: '\uFEA2', initial: '\uFEA3', medial: '\uFEA4' },
  { name: 'خاء', base: 'خ', isolated: '\uFEA5', final: '\uFEA6', initial: '\uFEA7', medial: '\uFEA8' },
  { name: 'دال', base: 'د', isolated: '\uFEA9', final: '\uFEAA', initial: null, medial: null },
  { name: 'ذال', base: 'ذ', isolated: '\uFEAB', final: '\uFEAC', initial: null, medial: null },
  { name: 'راء', base: 'ر', isolated: '\uFEAD', final: '\uFEAE', initial: null, medial: null },
  { name: 'زاي', base: 'ز', isolated: '\uFEAF', final: '\uFEB0', initial: null, medial: null },
  { name: 'سين', base: 'س', isolated: '\uFEB1', final: '\uFEB2', initial: '\uFEB3', medial: '\uFEB4' },
  { name: 'شين', base: 'ش', isolated: '\uFEB5', final: '\uFEB6', initial: '\uFEB7', medial: '\uFEB8' },
  { name: 'صاد', base: 'ص', isolated: '\uFEB9', final: '\uFEBA', initial: '\uFEBB', medial: '\uFEBC' },
  { name: 'ضاد', base: 'ض', isolated: '\uFEBD', final: '\uFEBE', initial: '\uFEBF', medial: '\uFEC0' },
  { name: 'طاء', base: 'ط', isolated: '\uFEC1', final: '\uFEC2', initial: '\uFEC3', medial: '\uFEC4' },
  { name: 'ظاء', base: 'ظ', isolated: '\uFEC5', final: '\uFEC6', initial: '\uFEC7', medial: '\uFEC8' },
  { name: 'عين', base: 'ع', isolated: '\uFEC9', final: '\uFECA', initial: '\uFECB', medial: '\uFECC' },
  { name: 'غين', base: 'غ', isolated: '\uFECD', final: '\uFECE', initial: '\uFECF', medial: '\uFED0' },
  { name: 'فاء', base: 'ف', isolated: '\uFED1', final: '\uFED2', initial: '\uFED3', medial: '\uFED4' },
  { name: 'قاف', base: 'ق', isolated: '\uFED5', final: '\uFED6', initial: '\uFED7', medial: '\uFED8' },
  { name: 'كاف', base: 'ك', isolated: '\uFED9', final: '\uFEDA', initial: '\uFEDB', medial: '\uFEDC' },
  { name: 'لام', base: 'ل', isolated: '\uFEDD', final: '\uFEDE', initial: '\uFEDF', medial: '\uFEE0' },
  { name: 'ميم', base: 'م', isolated: '\uFEE1', final: '\uFEE2', initial: '\uFEE3', medial: '\uFEE4' },
  { name: 'نون', base: 'ن', isolated: '\uFEE5', final: '\uFEE6', initial: '\uFEE7', medial: '\uFEE8' },
  { name: 'هاء', base: 'ه', isolated: '\uFEE9', final: '\uFEEA', initial: '\uFEEB', medial: '\uFEEC' },
  { name: 'واو', base: 'و', isolated: '\uFEED', final: '\uFEEE', initial: null, medial: null },
  { name: 'ياء', base: 'ي', isolated: '\uFEF1', final: '\uFEF2', initial: '\uFEF3', medial: '\uFEF4' },
  { name: 'همزة', base: 'ء', isolated: '\uFE80', final: null, initial: null, medial: null },
  { name: 'تاء مربوطة', base: 'ة', isolated: '\uFE93', final: '\uFE94', initial: null, medial: null },
  { name: 'ألف مقصورة', base: 'ى', isolated: '\uFEEF', final: '\uFEF0', initial: null, medial: null },
  { name: 'لام ألف', base: 'لا', isolated: '\uFEFB', final: '\uFEFC', initial: null, medial: null },
  { name: 'ألف مد', base: 'آ', isolated: '\uFE81', final: '\uFE82', initial: null, medial: null },
  { name: 'ألف همزة فوق', base: 'أ', isolated: '\uFE83', final: '\uFE84', initial: null, medial: null },
  { name: 'ألف همزة تحت', base: 'إ', isolated: '\uFE87', final: '\uFE88', initial: null, medial: null },
  { name: 'واو همزة', base: 'ؤ', isolated: '\uFE85', final: '\uFE86', initial: null, medial: null },
  { name: 'ياء همزة', base: 'ئ', isolated: '\uFE89', final: '\uFE8A', initial: '\uFE8B', medial: '\uFE8C' },
];

export const TASHKEEL: TashkeelMark[] = [
  { name: 'فتحة', char: '\u064E', code: 0x064E },
  { name: 'ضمة', char: '\u064F', code: 0x064F },
  { name: 'كسرة', char: '\u0650', code: 0x0650 },
  { name: 'سكون', char: '\u0652', code: 0x0652 },
  { name: 'شدة', char: '\u0651', code: 0x0651 },
  { name: 'تنوين فتح', char: '\u064B', code: 0x064B },
  { name: 'تنوين ضم', char: '\u064C', code: 0x064C },
  { name: 'تنوين كسر', char: '\u064D', code: 0x064D },
];

/**
 * Get all presentation form characters based on filter options.
 */
export function getArabicChars(options: {
  isolated?: boolean;
  initial?: boolean;
  medial?: boolean;
  final?: boolean;
  tashkeel?: boolean;
  english?: boolean;
}): { char: string; code: number; name: string }[] {
  const result: { char: string; code: number; name: string }[] = [];

  for (const letter of ARABIC_LETTERS) {
    if (options.isolated && letter.isolated) result.push({ char: letter.isolated, code: letter.isolated.codePointAt(0)!, name: letter.name + ' معزول' });
    if (options.final && letter.final) result.push({ char: letter.final, code: letter.final.codePointAt(0)!, name: letter.name + ' نهاية' });
    if (options.initial && letter.initial) result.push({ char: letter.initial, code: letter.initial.codePointAt(0)!, name: letter.name + ' بداية' });
    if (options.medial && letter.medial) result.push({ char: letter.medial, code: letter.medial.codePointAt(0)!, name: letter.name + ' وسط' });
  }

  if (options.tashkeel) {
    for (const t of TASHKEEL) {
      result.push({ char: t.char, code: t.code, name: t.name });
    }
  }

  if (options.english) {
    for (let i = 0x21; i <= 0x7E; i++) {
      result.push({ char: String.fromCharCode(i), code: i, name: String.fromCharCode(i) });
    }
  }

  return result;
}
