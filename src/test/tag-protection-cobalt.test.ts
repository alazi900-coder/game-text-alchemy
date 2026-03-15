import { describe, it, expect } from 'vitest';
import { protectTags, restoreTags } from '@/lib/tag-protection';

describe('Tag Protection — Cobalt Fire Emblem tags', () => {
  // Real lines from hubcommon_p3.txt
  const hubLines = [
    '$Type(4)',
    '$Window(0, "エル", "2")',
    '$Window(2, "エル")',
    '$Anim(1, "エル", "Nomal")',
    '$Anim(0, "エル", "EmoTalk")',
    'So, this is how the little ones train. I suppose\nit may benefit me to participate as well.$Wait(0)',
    '$Anim(1, "エル", "Smile")',
    'I adore small animals. In my world, creatures of\nthis kind were all but extinct.$Wait(0)',
  ];

  it('should protect $Window() tags with Japanese names', () => {
    const text = '$Window(0, "リュール", "1")';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('リュール');
    expect(cleanText).not.toContain('$Window');
    expect(tags.length).toBe(1);
    expect(tags[0].original).toBe('$Window(0, "リュール", "1")');
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(text);
  });

  it('should protect $Anim() tags', () => {
    const text = '$Anim(1, "エル", "Smile")';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('$Anim');
    expect(cleanText).not.toContain('エル');
    expect(tags[0].original).toBe('$Anim(1, "エル", "Smile")');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect $Type() tags', () => {
    const text = '$Type(2)';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('$Type');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect $Wait() at end of dialogue', () => {
    const text = 'So, this is how the little ones train.$Wait(0)';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).toContain('So, this is how the little ones train.');
    expect(cleanText).not.toContain('$Wait');
    expect(tags.length).toBe(1);
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect $P player name variable', () => {
    const text = "I'm the Divine Dragon $P.";
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('$P');
    expect(cleanText).toContain("I'm the Divine Dragon");
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect $Arg(0) in system text', () => {
    const text = '$Arg(0) Class';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('$Arg');
    expect(cleanText).toContain('Class');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect [MID_...] identifiers', () => {
    const text = '[MID_GR_El_C_#001]';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('MID_GR');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect [MAID_...] identifiers (accessories)', () => {
    const text = '[MAID_LueurWearM]';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('MAID_');
    expect(tags[0].original).toBe('[MAID_LueurWearM]');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect [MSID_...] identifiers (skills)', () => {
    const text = '[MSID_Hp_5]';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('MSID_');
    expect(tags[0].original).toBe('[MSID_Hp_5]');
    expect(restoreTags(cleanText, tags)).toBe(text);
  });

  it('should protect multiple tags in a full hub dialogue block', () => {
    const fullBlock = hubLines.join('\n');
    const { cleanText, tags } = protectTags(fullBlock);

    // All technical tags should be replaced
    expect(cleanText).not.toContain('$Type');
    expect(cleanText).not.toContain('$Window');
    expect(cleanText).not.toContain('$Anim');
    expect(cleanText).not.toContain('$Wait');
    expect(cleanText).not.toContain('エル');

    // Dialogue text should remain
    expect(cleanText).toContain('So, this is how the little ones train');
    expect(cleanText).toContain('I adore small animals');

    // Restore should be perfect
    const restored = restoreTags(cleanText, tags);
    expect(restored).toBe(fullBlock);
  });

  it('should protect %s and %d format specifiers', () => {
    const text = 'Dealt %d damage to %s enemies';
    const { cleanText, tags } = protectTags(text);
    expect(cleanText).not.toContain('%d');
    expect(cleanText).not.toContain('%s');
    expect(tags.length).toBe(2);
    expect(restoreTags(cleanText, tags)).toBe(text);
  });
});
