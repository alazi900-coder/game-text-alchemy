import { describe, it, expect } from 'vitest';

// Replicate the swapChars logic from useEditorState
function swapChars(t: string): string {
  const protected_: { placeholder: string; original: string }[] = [];
  let counter = 0;
  let safe = t.replace(/(\[\w+:[^\]]*?\s*\](?:\s*\([^)]{1,100}\))?|\{[\w]+\}|<[\w\/][^>]*>|[\uE000-\uE0FF]+|[\uFFF9-\uFFFB]+|\([A-Z][^)]{1,100}\))/g, (match) => {
    const ph = `\x01PROT${counter++}\x01`;
    protected_.push({ placeholder: ph, original: match });
    return ph;
  });
  safe = safe
    .replace(/\(/g, '\x00OPEN\x00').replace(/\)/g, '(').replace(/\x00OPEN\x00/g, ')')
    .replace(/</g, '\x00LT\x00').replace(/>/g, '<').replace(/\x00LT\x00/g, '>');
  for (const p of protected_) {
    safe = safe.replace(p.placeholder, p.original);
  }
  return safe;
}

describe('Mirror Characters', () => {
  it('should swap normal parentheses', () => {
    expect(swapChars('مرحبا (عالم)')).toBe('مرحبا )عالم(');
  });

  it('should swap angle brackets', () => {
    expect(swapChars('اذهب <يمين>')).toBe('اذهب >يمين<');
  });

  it('should NOT swap brackets inside [Tag:Value]', () => {
    const input = 'نص [ML:number digit=8 ] بعده';
    const result = swapChars(input);
    expect(result).toBe('نص [ML:number digit=8 ] بعده');
  });

  it('should NOT swap brackets inside {variable}', () => {
    const input = 'عدد {count} عناصر';
    expect(swapChars(input)).toBe('عدد {count} عناصر');
  });

  it('should NOT swap HTML-like tags', () => {
    const input = 'نص <br/> جديد';
    expect(swapChars(input)).toBe('نص <br/> جديد');
  });

  it('should NOT swap descriptive parentheses like (Crowd noise)', () => {
    const input = 'صوت (Crowd noise) هنا';
    expect(swapChars(input)).toBe('صوت (Crowd noise) هنا');
  });

  it('should swap normal parens but keep technical tags intact', () => {
    const input = 'مرحبا (عالم) [ML:Feeling ] نهاية';
    const result = swapChars(input);
    expect(result).toBe('مرحبا )عالم( [ML:Feeling ] نهاية');
  });

  it('should handle PUA characters without swapping', () => {
    const input = '\uE001\uE002 نص (عادي)';
    const result = swapChars(input);
    expect(result).toBe('\uE001\uE002 نص )عادي(');
  });

  // === Additional real-world game text cases ===

  it('should protect [ML:number digit=8 ](Crowd noise) compound tag', () => {
    const input = 'صوت [ML:number digit=8 ](Crowd noise of children) عالي';
    const result = swapChars(input);
    expect(result).toBe('صوت [ML:number digit=8 ](Crowd noise of children) عالي');
  });

  it('should protect multiple [Tag:Value] tags in one string', () => {
    const input = 'اضغط [ML:Feeling ] ثم (تأكيد) ثم [ML:undisp ]';
    const result = swapChars(input);
    // Normal (تأكيد) swapped, both [ML:...] untouched
    expect(result).toBe('اضغط [ML:Feeling ] ثم )تأكيد( ثم [ML:undisp ]');
  });

  it('should swap nested normal parens but protect tags', () => {
    const input = '(أ (ب)) [ML:test ]';
    const result = swapChars(input);
    expect(result).toBe(')أ )ب(( [ML:test ]');
  });

  it('should handle text with only technical tags and no normal brackets', () => {
    const input = '[ML:Feeling ] مرحبا {name} عالم';
    const result = swapChars(input);
    expect(result).toBe('[ML:Feeling ] مرحبا {name} عالم'); // no change
  });

  it('should handle mixed PUA + normal parens + tags', () => {
    const input = '\uE010 (اسم) [ML:number ] نهاية';
    const result = swapChars(input);
    expect(result).toBe('\uE010 )اسم( [ML:number ] نهاية');
  });

  it('should protect Unicode control chars \\uFFF9-\\uFFFB from swapping', () => {
    const input = '\uFFF9annotation\uFFFA alt\uFFFB (عادي)';
    const result = swapChars(input);
    // Control chars untouched, normal parens swapped
    expect(result).toBe('\uFFF9annotation\uFFFA alt\uFFFB )عادي(');
  });
});
