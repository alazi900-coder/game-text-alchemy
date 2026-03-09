import { describe, it, expect } from 'vitest';
import { murmur3_32, unhashLabel, isKnownHash, addCustomNames } from '../lib/bdat-hash-dictionary';

describe('murmur3_32', () => {
  it('returns consistent hashes for known strings', () => {
    // Same input should always produce same output
    const h1 = murmur3_32('name');
    const h2 = murmur3_32('name');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different strings', () => {
    expect(murmur3_32('name')).not.toBe(murmur3_32('Name'));
    expect(murmur3_32('FLD_NpcList')).not.toBe(murmur3_32('BTL_Arts_En'));
  });

  it('returns a 32-bit unsigned integer', () => {
    const h = murmur3_32('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('unhashLabel', () => {
  it('resolves known table names', () => {
    const knownNames = [
      'FLD_NpcList', 'BTL_Arts_En', 'MNU_Msg', 'ITM_Gem',
      'QST_List', 'CHR_Pc', 'EVT_listBf', 'DLC_MapInfo',
    ];
    for (const name of knownNames) {
      const hash = murmur3_32(name);
      expect(unhashLabel(hash)).toBe(name);
    }
  });

  it('resolves known column names', () => {
    const knownCols = [
      'name', 'Name', 'caption', 'text', 'message',
      'ID', 'HP', 'Atk', 'Def', 'Level', 'Price',
      'Msg_Name', 'MsgIdInfo', 'DebugName',
    ];
    for (const col of knownCols) {
      const hash = murmur3_32(col);
      expect(unhashLabel(hash)).toBe(col);
    }
  });

  it('returns hex for unknown hashes', () => {
    const result = unhashLabel(0xDEADBEEF);
    expect(result).toBe('<0xdeadbeef>');
  });
});

describe('isKnownHash', () => {
  it('returns true for known names', () => {
    expect(isKnownHash(murmur3_32('name'))).toBe(true);
    expect(isKnownHash(murmur3_32('FLD_NpcList'))).toBe(true);
  });

  it('returns false for unknown hashes', () => {
    expect(isKnownHash(0x12345678)).toBe(false);
  });
});

describe('addCustomNames', () => {
  it('adds new names to the dictionary', () => {
    const customName = 'MY_CUSTOM_TABLE_XYZ';
    const hash = murmur3_32(customName);
    expect(isKnownHash(hash)).toBe(false);
    
    addCustomNames([customName]);
    expect(isKnownHash(hash)).toBe(true);
    expect(unhashLabel(hash)).toBe(customName);
  });
});
