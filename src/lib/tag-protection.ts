/**
 * Tag Protection System
 * Protects technical tags (PUA icons, [Tag:Value], {variables}, control chars, [MSBT:...])
 * before AI translation and restores them afterward.
 */

export interface ProtectedTag {
  index: number;
  original: string;
  position: number;
}

export interface ProtectedText {
  cleanText: string;
  tags: ProtectedTag[];
}

// Patterns to match technical tags in order of priority
const TAG_PATTERNS: RegExp[] = [
  /\[\s*\w+:\w[^\]]*\][^[]*?\[\/\s*\w+:\w[^\]]*\]/g, // Paired tags: [System:Ruby rt=x ]content[/System:Ruby]
  /[\uE000-\uE0FF]+/g,                     // PUA icons (consecutive = atomic block)
  /\[\s*\w+\s*:[^\]]*?\s*\]/g,             // [Tag:Value] / [MSBT:label]
  /\[\s*\w+\s*=\s*\w[^\]]*\]/g,            // [TAG=Value] patterns
  /\{\s*\w+\s*:\s*\w[^}]*\}/g,             // {TAG:Value} patterns
  /\{[\w]+\}/g,                              // {variable} placeholders
  /[\uFFF9-\uFFFC]/g,                       // Unicode special markers
  /<[\w\/][^>]*>/g,                          // HTML-like tags
];

/**
 * Extract and replace all technical tags with numbered placeholders.
 */
export function protectTags(text: string): ProtectedText {
  const matches: { start: number; end: number; original: string }[] = [];

  for (const pattern of TAG_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = matches.some(m => start < m.end && end > m.start);
      if (!overlaps) {
        matches.push({ start, end, original: match[0] });
      }
    }
  }

  matches.sort((a, b) => a.start - b.start);

  if (matches.length === 0) {
    return { cleanText: text, tags: [] };
  }

  const tags: ProtectedTag[] = [];
  let cleanText = '';
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    cleanText += text.slice(lastEnd, m.start);
    const placeholder = `TAG_${i}`;
    cleanText += placeholder;
    tags.push({ index: i, original: m.original, position: m.start });
    lastEnd = m.end;
  }
  cleanText += text.slice(lastEnd);

  return { cleanText, tags };
}

/**
 * Restore original tags from placeholders in translated text.
 */
export function restoreTags(translatedText: string, tags: ProtectedTag[]): string {
  if (tags.length === 0) return translatedText;

  let result = translatedText;
  for (let i = tags.length - 1; i >= 0; i--) {
    const placeholder = `TAG_${i}`;
    result = result.replace(placeholder, tags[i].original);
  }

  return result;
}
