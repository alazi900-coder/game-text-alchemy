/**
 * Ensures a value is a valid Record<string, string>.
 * If the value is corrupted (number, null, array, etc.), returns {} and logs a warning.
 */
export function sanitizeTranslations(val: unknown, source?: string): Record<string, string> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, string>;
  }
  if (val !== null && val !== undefined) {
    console.warn(`[SANITIZE] translations was ${typeof val} (${String(val).slice(0, 50)})${source ? ` at ${source}` : ''} — reset to {}`);
  }
  return {};
}
