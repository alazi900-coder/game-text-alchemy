/**
 * Tests for balanceLines orphan-word prevention.
 * These duplicate the core functions from translate-entries edge function
 * to enable local unit testing of the line-balancing algorithm.
 */
import { describe, it, expect } from 'vitest';

// --- Duplicated core logic from translate-entries/index.ts ---

const TAG_SHIELD_PATTERN = /[\uE000-\uE0FF]+|\[\s*\w+\s*:[^\]]*?\s*\]|[\uFFF9-\uFFFC]+/g;

interface ShieldResult {
  shielded: string;
  map: Map<string, { placeholder: string; original: string; displayLen: number }>;
}

function shieldTagsForBalance(text: string): ShieldResult {
  const map = new Map<string, { placeholder: string; original: string; displayLen: number }>();
  let idx = 0;
  const shielded = text.replace(TAG_SHIELD_PATTERN, (match) => {
    const placeholder = `◆${idx}◆`;
    map.set(placeholder, { placeholder, original: match, displayLen: match.length });
    idx++;
    return placeholder;
  });
  return { shielded, map };
}

function unshieldTagsAfterBalance(text: string, map: Map<string, { placeholder: string; original: string; displayLen: number }>): string {
  let result = text;
  for (const [placeholder, info] of map) {
    result = result.replace(placeholder, info.original);
  }
  return result;
}

const TARGET_MAX = 42;
const HARD_MAX = 48;

function countLexicalWords(line: string): number {
  const tokens = line.split(/\s+/).filter(Boolean);
  let count = 0;
  for (const token of tokens) {
    if (/^◆\d+◆$/.test(token)) continue;
    if (/^TAG_\d+$/i.test(token)) continue;
    if (/^[\p{P}\p{S}]+$/u.test(token)) continue;
    if (/[\p{L}\p{N}]/u.test(token)) count++;
  }
  return count;
}

function scoreSplit(lines: string[]): number {
  if (lines.length <= 1) return 0;
  const lengths = lines.map(l => l.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  let cost = 0;
  for (let i = 0; i < lines.length; i++) {
    const dev = lengths[i] - avg;
    cost += dev * dev;
    if (i > 0 && i < lines.length - 1) {
      const lexical = countLexicalWords(lines[i]);
      if (lexical <= 1) cost += 50000;
      if (lexical === 2 && lengths[i] < 10) cost += 5000;
    }
  }
  return cost;
}

function dpSplitShielded(words: string[], nLines: number, wordDisplayLen: (w: string) => number): string[] | null {
  const n = words.length;
  if (n < nLines) return null;

  const lineLen = (from: number, to: number): number => {
    let len = 0;
    for (let k = from; k < to; k++) {
      len += wordDisplayLen(words[k]) + (k > from ? 1 : 0);
    }
    return len;
  };

  const totalLen = lineLen(0, n);
  const ideal = totalLen / nLines;
  const INF = 1e18;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(nLines + 1).fill(INF));
  const choice: number[][] = Array.from({ length: n + 1 }, () => new Array(nLines + 1).fill(0));
  dp[0][0] = 0;

  for (let k = 1; k <= nLines; k++) {
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        const ll = lineLen(j, i);
        if (ll > HARD_MAX && i - j > 1) continue;
        const deviation = ll - ideal;
        let cost = deviation * deviation;
        const wordCount = i - j;
        const isMiddleLine = k > 1 && k < nLines;
        const lexicalCount = countLexicalWords(words.slice(j, i).join(' '));
        if (lexicalCount <= 1 && isMiddleLine) cost += 50000;
        if (wordCount === 1 && isMiddleLine) cost += 50000;
        if (ll < ideal * 0.4 && lexicalCount < 3) cost += 5000;
        const total = dp[j][k - 1] + cost;
        if (total < dp[i][k]) {
          dp[i][k] = total;
          choice[i][k] = j;
        }
      }
    }
  }

  if (dp[n][nLines] >= INF) return null;
  const lines: string[] = new Array(nLines);
  let pos = n;
  for (let k = nLines; k >= 1; k--) {
    const start = choice[pos][k];
    lines[k - 1] = words.slice(start, pos).join(' ');
    pos = start;
  }
  return lines;
}

function fixOrphans(lines: string[]): string[] {
  if (lines.length <= 1) return lines;
  const result = [...lines];
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 8) {
    changed = false;
    iterations++;
    for (let i = 0; i < result.length; i++) {
      const lexical = countLexicalWords(result[i]);
      if (lexical <= 1 && result.length > 1) {
        if (i === 0) {
          result[1] = `${result[0]} ${result[1]}`.replace(/\s{2,}/g, ' ').trim();
          result.splice(0, 1);
        } else if (i === result.length - 1) {
          result[i - 1] = `${result[i - 1]} ${result[i]}`.replace(/\s{2,}/g, ' ').trim();
          result.splice(i, 1);
        } else {
          const prevLen = result[i - 1].length;
          const nextLen = result[i + 1].length;
          if (prevLen <= nextLen) {
            result[i - 1] = `${result[i - 1]} ${result[i]}`.replace(/\s{2,}/g, ' ').trim();
            result.splice(i, 1);
          } else {
            result[i + 1] = `${result[i]} ${result[i + 1]}`.replace(/\s{2,}/g, ' ').trim();
            result.splice(i, 1);
          }
        }
        changed = true;
        break;
      }
    }
  }
  return result;
}

function balanceLines(text: string): string {
  const stripped = text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const { shielded, map } = shieldTagsForBalance(stripped);
  let displayLen = shielded.length;
  for (const [placeholder, info] of map) {
    displayLen += info.displayLen - placeholder.length;
  }
  if (displayLen <= TARGET_MAX) return stripped;

  const words = shielded.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) return stripped;

  const wordDisplayLen = (w: string): number => {
    let len = w.length;
    for (const [ph, info] of map) {
      if (w.includes(ph)) len += info.displayLen - ph.length;
    }
    return len;
  };

  const totalLen = words.reduce((s, w) => s + wordDisplayLen(w), 0) + (words.length - 1);
  const numLines = Math.max(2, Math.ceil(totalLen / TARGET_MAX));

  let bestResult: string[] | null = null;
  let bestCost = Infinity;
  for (let nLines = numLines; nLines <= Math.min(numLines + 1, words.length); nLines++) {
    const result = dpSplitShielded(words, nLines, wordDisplayLen);
    if (result) {
      const cost = scoreSplit(result.map(line => {
        const displayLine = line.split(/\s+/).map(w => 'x'.repeat(wordDisplayLen(w))).join(' ');
        return displayLine;
      }));
      if (cost < bestCost) { bestCost = cost; bestResult = result; }
    }
  }
  if (!bestResult) return stripped;
  bestResult = fixOrphans(bestResult);
  return bestResult.map(line => unshieldTagsAfterBalance(line, map)).join('\n');
}

// --- Tests ---

/** Helper: check no line has only 1 lexical word (orphan) */
function assertNoOrphanLines(result: string, label: string) {
  const lines = result.split('\n');
  if (lines.length <= 1) return; // single line is fine
  for (let i = 0; i < lines.length; i++) {
    const lexical = countLexicalWords(lines[i]);
    expect(lexical, `${label} — line ${i} "${lines[i]}" has only ${lexical} lexical word(s)`).toBeGreaterThanOrEqual(2);
  }
}

describe('balanceLines — orphan word prevention', () => {

  it('should not leave "و" alone on a middle line', () => {
    // Simulates: tag + Arabic text where "و" could end up alone
    const input = '[ML:icon icon=btn_a ] اضغط على الزر و ابدأ المغامرة الجديدة الآن';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'tag + و');
  });

  it('should not leave a single Arabic word on a middle line', () => {
    const input = 'استخدم القدرة الخاصة لتدمير الأعداء و حماية الحلفاء في المعركة';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'long Arabic text');
  });

  it('should not leave "و" alone when surrounded by tags', () => {
    const input = '[ML:icon icon=btn_a ] و [ML:icon icon=btn_b ] اضغط لتأكيد الاختيار النهائي';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'و between tags');
  });

  it('should handle text with only tags and one word', () => {
    const input = '[ML:icon icon=btn_a ] [ML:number number=10 ] اضغط على الزر للمتابعة الآن فوراً';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'tags + one word');
  });

  it('should balance pure Arabic text without orphans', () => {
    const input = 'هذه مهمة صعبة جداً و تحتاج إلى تركيز عالٍ و صبر كبير لإنجازها بنجاح';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'pure Arabic');
  });

  it('should not orphan first or last line', () => {
    const input = 'و استخدم القدرة الخاصة لتدمير جميع الأعداء المحيطين بك فوراً';
    const result = balanceLines(input);
    assertNoOrphanLines(result, 'starts with و');
  });

  it('should preserve tags intact after balancing', () => {
    const tag = '[ML:icon icon=btn_a ]';
    const input = `${tag} اضغط هنا لبدء المهمة الجديدة و المغامرة الكبرى`;
    const result = balanceLines(input);
    expect(result).toContain(tag);
  });

  it('short text should not be split', () => {
    const input = 'كلمة قصيرة';
    const result = balanceLines(input);
    expect(result).not.toContain('\n');
  });

  it('countLexicalWords ignores tag placeholders', () => {
    expect(countLexicalWords('◆0◆ و')).toBe(1);
    expect(countLexicalWords('◆0◆ و ◆1◆')).toBe(1);
    expect(countLexicalWords('كلمة أخرى')).toBe(2);
    expect(countLexicalWords('◆0◆')).toBe(0);
    expect(countLexicalWords('...')).toBe(0);
  });
});
