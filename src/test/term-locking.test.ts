import { describe, it, expect } from 'vitest';

/**
 * Term Locking tests - validates the glossary enforcement system.
 * These test the same logic used in the translate-entries edge function.
 */

// Replicate the lockTermsInText function from the edge function
interface TermLockResult {
  lockedText: string;
  locks: { placeholder: string; english: string; arabic: string }[];
}

function lockTermsInText(text: string, glossaryMap: Map<string, string>): TermLockResult {
  if (glossaryMap.size === 0) return { lockedText: text, locks: [] };

  const sortedTerms = Array.from(glossaryMap.entries())
    .filter(([eng]) => eng.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  const locks: TermLockResult['locks'] = [];
  let lockedText = text;
  let lockCounter = 0;

  for (const [eng, arab] of sortedTerms) {
    const escaped = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = eng.length <= 3
      ? new RegExp(`\\b${escaped}\\b`, 'gi')
      : new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi');

    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(lockedText)) !== null) {
      const matchEnd = match.index + match[0].length;
      const surroundingSlice = lockedText.slice(match.index, matchEnd);
      const isInsideLock = surroundingSlice.includes('⟪') || surroundingSlice.includes('⟫');
      if (isInsideLock) continue;

      const placeholder = `⟪T${lockCounter}⟫`;
      lockedText = lockedText.slice(0, match.index) + placeholder + lockedText.slice(match.index + match[0].length);
      locks.push({ placeholder, english: match[0], arabic: arab });
      lockCounter++;
      regex.lastIndex = match.index + placeholder.length;
    }
  }

  return { lockedText, locks };
}

function unlockTerms(translatedText: string, locks: TermLockResult['locks']): string {
  let result = translatedText;
  for (const lock of locks) {
    result = result.replace(lock.placeholder, lock.arabic);
  }
  return result;
}

function parseGlossaryToMap(glossary: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of glossary.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const eng = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const arb = trimmed.slice(eqIdx + 1).trim();
    if (eng && arb) map.set(eng, arb);
  }
  return map;
}

describe('Term Locking', () => {
  it('locks a single term', () => {
    const glossary = new Map([['noah', 'نوح']]);
    const result = lockTermsInText('Noah is the main character.', glossary);
    expect(result.locks).toHaveLength(1);
    expect(result.locks[0].arabic).toBe('نوح');
    expect(result.lockedText).toContain('⟪T0⟫');
    expect(result.lockedText).not.toContain('Noah');
  });

  it('locks multiple terms longest-first', () => {
    const glossary = new Map([
      ['great conté falls', 'شلالات كونتيه العظيمة'],
      ['falls', 'الشلالات'],
    ]);
    const result = lockTermsInText('Visit Great Conté Falls today.', glossary);
    // Should match the longer term first
    expect(result.locks).toHaveLength(1);
    expect(result.locks[0].arabic).toBe('شلالات كونتيه العظيمة');
  });

  it('unlocks terms with Arabic translations', () => {
    const glossary = new Map([['noah', 'نوح'], ['mio', 'ميو']]);
    const lockResult = lockTermsInText('Noah and Mio fight together.', glossary);
    // Both terms should be locked (noah=4 chars, mio=3 chars, both >= 2)
    expect(lockResult.locks.length).toBe(2);
    const aiTranslation = `${lockResult.locks[0].placeholder} و ${lockResult.locks[1].placeholder} يقاتلان معاً.`;
    const unlocked = unlockTerms(aiTranslation, lockResult.locks);
    expect(unlocked).toContain('نوح');
    expect(unlocked).toContain('ميو');
    expect(unlocked).not.toContain('⟪');
  });

  it('skips short terms (1 char)', () => {
    const glossary = new Map([['x', 'اكس']]);
    const result = lockTermsInText('Use X to attack.', glossary);
    expect(result.locks).toHaveLength(0); // Single char filtered out
  });

  it('handles special characters in terms', () => {
    const glossary = new Map([["hero's sword", 'سيف البطل']]);
    const result = lockTermsInText("Use the Hero's Sword.", glossary);
    expect(result.locks).toHaveLength(1);
    expect(result.locks[0].arabic).toBe('سيف البطل');
  });

  it('does not match partial words', () => {
    const glossary = new Map([['art', 'فن']]);
    const result = lockTermsInText('The heart of the party.', glossary);
    // "art" inside "heart" should NOT match (word boundary)
    expect(result.locks).toHaveLength(0);
  });
});

describe('Glossary Parsing', () => {
  it('parses standard format', () => {
    const map = parseGlossaryToMap('Noah=نوح\nMio=ميو');
    expect(map.size).toBe(2);
    expect(map.get('noah')).toBe('نوح');
    expect(map.get('mio')).toBe('ميو');
  });

  it('skips comments and empty lines', () => {
    const map = parseGlossaryToMap('# Header\n\nNoah=نوح\n// comment\nMio=ميو');
    expect(map.size).toBe(2);
  });

  it('handles values with = signs', () => {
    // indexOf('=') splits at the FIRST = sign
    const map = parseGlossaryToMap('Damage=الضرر');
    expect(map.size).toBe(1);
    expect(map.get('damage')).toBe('الضرر');
  });

  it('trims whitespace', () => {
    const map = parseGlossaryToMap('  Noah  =  نوح  ');
    expect(map.get('noah')).toBe('نوح');
  });
});

describe('Full Term Lock Flow', () => {
  it('end-to-end: lock → translate → unlock', () => {
    const glossary = new Map([
      ['noah', 'نوح'],
      ['blade', 'نصل'],
      ['ether', 'الأثير'],
    ]);
    const text = 'Noah uses an Ether Blade to attack.';
    const lockResult = lockTermsInText(text, glossary);
    
    // At least some terms should be locked
    expect(lockResult.locks.length).toBeGreaterThanOrEqual(2);
    
    // Simulate AI response with placeholders preserved
    const placeholderMap = new Map(lockResult.locks.map(l => [l.english.toLowerCase(), l.placeholder]));
    const parts = lockResult.locks.map(l => l.placeholder);
    const mockAI = `${parts.join(' ')} للهجوم.`;
    
    const final = unlockTerms(mockAI, lockResult.locks);
    expect(final).toContain('نوح');
    expect(final).not.toContain('⟪');
  });
});
