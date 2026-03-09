/**
 * Arabic Sentence Splitter — detects and fixes merged Arabic words
 * Uses linguistic rules (no AI) based on Arabic non-connecting letters.
 */
import { isKnownArabicWord } from './arabic-common-words';

// Non-connecting Arabic letters: these NEVER connect to the letter after them
// If one of these is followed immediately by another Arabic letter, there's likely a missing space
const NON_CONNECTING = new Set([
  '\u0627', // ا alef
  '\u0623', // أ alef hamza above
  '\u0625', // إ alef hamza below
  '\u0622', // آ alef madda
  '\u062F', // د dal
  '\u0630', // ذ dhal
  '\u0631', // ر ra
  '\u0632', // ز zay
  '\u0648', // و waw
  '\u0629', // ة ta marbuta
  '\u0649', // ى alef maksura
  '\u0624', // ؤ waw hamza
  '\u0621', // ء hamza alone
]);

// Ta marbuta ALWAYS ends a word — if followed by any Arabic letter, it's 100% a merge
const WORD_ENDERS = new Set([
  '\u0629', // ة ta marbuta
  '\u0649', // ى alef maksura
]);

// Arabic letter range (basic block only, excludes diacritics)
const isArabicLetter = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c >= 0x0621 && c <= 0x064A) || (c >= 0x0671 && c <= 0x06D3);
};

const isDiacritic = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c >= 0x064B && c <= 0x0652) || c === 0x0670 || c === 0x0640;
};

const isPUA = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c >= 0xE000 && c <= 0xF8FF) || (c >= 0xFFF9 && c <= 0xFFFC);
};

const isArabicPresentationForm = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF);
};

export interface MergePoint {
  position: number;       // position in the word where split should happen
  charBefore: string;     // the non-connecting char
  charAfter: string;      // the next char
  rule: 'non-connecting' | 'medial-al' | 'long-word';
}

export interface SplitResult {
  original: string;       // original word
  fixed: string;          // word after splitting
  mergePoints: MergePoint[];
}

/**
 * Detect merge points in a single Arabic word.
 * CONSERVATIVE approach: only split on highly reliable patterns to avoid
 * breaking valid Arabic words that contain non-connecting letters internally.
 * 
 * Reliable patterns:
 * 1. Word-enders (ة, ى) followed by Arabic letter — these truly end words
 *    BUT require the remaining part to be at least 3 Arabic chars
 * 2. Medial "ال" — definite article appearing mid-word
 * 
 * We do NOT split on general non-connecting letters (د، ر، ز، و، ا...)
 * because they appear inside valid single words constantly
 * (e.g. المرتفع، المستودع، الأوغاد، مستعمرة)
 */
export function detectMergedInWord(word: string): MergePoint[] {
  const points: MergePoint[] = [];
  const chars = [...word];
  
  for (let i = 0; i < chars.length - 1; i++) {
    const ch = chars[i];
    // Skip diacritics and PUA markers
    if (isDiacritic(ch) || isPUA(ch) || isArabicPresentationForm(ch)) continue;
    
    // Find next non-diacritic char
    let nextIdx = i + 1;
    while (nextIdx < chars.length && (isDiacritic(chars[nextIdx]) || isPUA(chars[nextIdx]))) {
      nextIdx++;
    }
    if (nextIdx >= chars.length) break;
    
    const nextCh = chars[nextIdx];
    if (!isArabicLetter(nextCh)) continue;
    
    // Rule 1: Word-enders (ة، ى) — these truly end words
    // Only split if the part AFTER has at least 3 Arabic letters
    if (WORD_ENDERS.has(ch)) {
      const remaining = chars.slice(nextIdx);
      const remainingArabic = remaining.filter(c => isArabicLetter(c));
      if (remainingArabic.length >= 3) {
        points.push({
          position: nextIdx,
          charBefore: ch,
          charAfter: nextCh,
          rule: 'non-connecting',
        });
      }
      continue;
    }
  }
  
  // Rule 2: Medial "ال" — ال appearing in the middle of a word (not at start)
  const alefLamPattern = /[\u0621-\u064A]\u0627\u0644[\u0621-\u064A]/g;
  let match;
  while ((match = alefLamPattern.exec(word)) !== null) {
    const pos = match.index + 1; // position of the ا in ال
    // Check it's not already covered
    if (!points.some(p => p.position === pos)) {
      points.push({
        position: pos,
        charBefore: word[match.index],
        charAfter: '\u0627',
        rule: 'medial-al',
      });
    }
  }
  
  return points;
}

/**
 * Split a single word at detected merge points
 */
export function splitWord(word: string, mergePoints: MergePoint[]): string {
  if (mergePoints.length === 0) return word;
  
  const chars = [...word];
  const positions = mergePoints.map(p => p.position).sort((a, b) => b - a); // reverse order
  
  for (const pos of positions) {
    chars.splice(pos, 0, ' ');
  }
  
  return chars.join('');
}

/**
 * Process a full text string: find Arabic words and detect merges
 */
export function splitMergedSentences(text: string): { result: string; splitCount: number } {
  if (!text) return { result: text, splitCount: 0 };
  
  // Skip texts with Arabic presentation forms (already processed)
  if ([...text].some(ch => isArabicPresentationForm(ch))) {
    return { result: text, splitCount: 0 };
  }
  
  let splitCount = 0;
  
  // Split by spaces and process each token
  const tokens = text.split(/(\s+)/);
  const processed = tokens.map(token => {
    // Skip whitespace tokens
    if (/^\s+$/.test(token)) return token;
    
    // Skip if not Arabic
    if (![...token].some(ch => isArabicLetter(ch))) return token;
    
    // Skip known Arabic words (whitelist)
    if (isKnownArabicWord(token)) return token;
    
    // Skip short words (7 Arabic chars or less are usually single words)
    const arabicChars = [...token].filter(ch => isArabicLetter(ch));
    if (arabicChars.length <= 7) return token;
    
    const points = detectMergedInWord(token);
    if (points.length === 0) return token;
    
    splitCount += points.length;
    return splitWord(token, points);
  });
  
  return { result: processed.join(''), splitCount };
}

export interface SentenceSplitResult {
  key: string;
  original: string;       // English original
  before: string;         // translation before fix
  after: string;          // translation after fix
  splits: number;         // number of split points found
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * Scan all translations for merged words
 */
export function scanAllTranslations(
  translations: Record<string, string>,
  entries: { msbtFile: string; index: number; original: string }[]
): SentenceSplitResult[] {
  const results: SentenceSplitResult[] = [];
  
  for (const entry of entries) {
    const key = `${entry.msbtFile}:${entry.index}`;
    const translation = translations[key];
    if (!translation?.trim()) continue;
    
    // Skip if same as original (untranslated)
    if (translation.trim() === entry.original.trim()) continue;
    
    const { result, splitCount } = splitMergedSentences(translation);
    if (splitCount > 0 && result !== translation) {
      results.push({
        key,
        original: entry.original,
        before: translation,
        after: result,
        splits: splitCount,
        status: 'pending',
      });
    }
  }
  
  return results;
}
