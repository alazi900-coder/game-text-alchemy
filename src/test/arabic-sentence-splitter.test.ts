import { describe, it, expect } from 'vitest';
import { detectMergedInWord, splitMergedSentences, scanAllTranslations } from '@/lib/arabic-sentence-splitter';

describe('arabic-sentence-splitter', () => {
  it('detects ta marbuta merge when remainder is long enough', () => {
    // "كلمةجديدة" — ة followed by جديدة (4 Arabic chars) → should split
    const points = detectMergedInWord('كلمةجديدة');
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].charBefore).toBe('\u0629');
  });

  it('splits merged words correctly', () => {
    // Need 8+ Arabic chars total for threshold
    const { result, splitCount } = splitMergedSentences('مدرسةكبيرة');
    expect(splitCount).toBeGreaterThan(0);
    expect(result).toContain(' ');
  });

  it('does not split normal Arabic text', () => {
    const { result, splitCount } = splitMergedSentences('كلمة جديدة');
    expect(splitCount).toBe(0);
    expect(result).toBe('كلمة جديدة');
  });

  it('does not split short words', () => {
    const { splitCount } = splitMergedSentences('من');
    expect(splitCount).toBe(0);
  });

  it('detects medial ال', () => {
    // "كتابالمدرسة" should detect ال in middle
    const { result, splitCount } = splitMergedSentences('كتابالمدرسة');
    expect(splitCount).toBeGreaterThan(0);
  });

  it('scanAllTranslations returns results for merged text', () => {
    const entries = [
      { msbtFile: 'test.bdat', index: 0, original: 'Hello' },
    ];
    // Use a long enough merged text with medial ال
    const translations = { 'test.bdat:0': 'كتابالمدرسة' };
    const results = scanAllTranslations(translations, entries);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].splits).toBeGreaterThan(0);
  });

  it('skips presentation forms text', () => {
    const { splitCount } = splitMergedSentences('\uFE8D\uFEE0\uFEE4\uFEA9\uFEAE\uFEB3\uFEA4');
    expect(splitCount).toBe(0);
  });

  it('does NOT split valid single words with non-connecting letters', () => {
    // These are all valid single Arabic words — must NOT be split
    const validWords = ['المرتفع', 'المستودع', 'الأوغاد', 'مستعمرة'];
    for (const word of validWords) {
      const { splitCount } = splitMergedSentences(word);
      expect(splitCount).toBe(0);
    }
  });

  it('detects ta marbuta followed by long enough word', () => {
    // "مدرسةكبيرة" = مدرسة + كبيرة (4 Arabic chars after ة)
    const points = detectMergedInWord('مدرسةكبيرة');
    expect(points.length).toBeGreaterThan(0);
    expect(points.some(p => p.charBefore === '\u0629')).toBe(true);
  });

  it('does NOT split ta marbuta with short remainder', () => {
    // "مستعمرة" — ة is at end, no merge
    const points = detectMergedInWord('مستعمرة');
    expect(points.length).toBe(0);
  });

  it('detects alef maksura with long enough remainder', () => {
    // "علىالطاولة" = على + الطاولة — medial ال should catch this
    const { splitCount } = splitMergedSentences('علىالطاولة');
    expect(splitCount).toBeGreaterThan(0);
  });
});
