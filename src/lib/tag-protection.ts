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

// LM2 HD controller button icons (Latin Extended-B used as button placeholders)
const LM2_BUTTON_ICONS = /[ɣɐɓɑɔɛɜɞɤɥɨɪɯɵɶʀʁʂʃʄʇʈ]/g;

// Patterns to match technical tags in order of priority
const TAG_PATTERNS: RegExp[] = [
  /\[\s*\w+:\w[^\]]*\][^[]*?\[\/\s*\w+:\w[^\]]*\]/g, // Paired tags: [System:Ruby rt=x ]content[/System:Ruby]
  /^\[M[A-Z]*ID_[^\]]+\]$/gm,               // Cobalt line identifiers [MID_...], [MAID_...], [MSID_...]
  /[\uE000-\uE0FF]+/g,                     // PUA icons (consecutive = atomic block)
  /\$\w+\([^)]*\)/g,                        // Cobalt tags with args: $Arg(0), $Icon("A")
  /\$\w+/g,                                 // Cobalt simple tags: $P, $n, $t
  /\[\s*\w+\s*:[^\]]*?\s*\]/g,             // [Tag:Value] / [MSBT:label]
  /\d+\s*\[[A-Z]{2,10}\]/g,               // N[TAG] patterns (e.g. 1[ML], 1 [ML])
  /\[[A-Z]{2,10}\]\s*\d+/g,               // [TAG]N patterns (e.g. [ML]1, [ML] 1)
  /\[\s*\w+\s*=\s*\w[^\]]*\]/g,            // [TAG=Value] patterns
  /\{\s*\w+\s*:\s*\w[^}]*\}/g,             // {TAG:Value} patterns
  /\{\/\w+\}/g,                              // Closing tags: {/tp}, {/clr}
  /\{[\w]+\}/g,                              // {variable} placeholders
  /%[sd]/g,                                  // Format specifiers: %s, %d
  /[\uFFF9-\uFFFC]/g,                       // Unicode special markers
  /<[\w\/][^>]*>/g,                          // HTML-like tags
  LM2_BUTTON_ICONS,                          // LM2 HD controller button icons
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

/**
 * Post-validation: compare original text tags with translated text tags.
 * If any tags were modified or deleted, restore them automatically.
 * If any foreign tags were invented by AI, remove them.
 */
export function validateAndRestoreTags(original: string, translated: string): string {
  const origTags = extractAllTechTags(original);
  if (origTags.length === 0) return translated;

  let result = translated;
  const origTagSet = new Set(origTags);

  // Extract tags from translation
  const transTags = extractAllTechTags(result);

  // Remove invented tags (exist in translation but not in original)
  for (const t of transTags) {
    if (!origTagSet.has(t)) {
      result = result.replace(t, '');
    }
  }

  // Re-append missing tags (exist in original but not in translation)
  const currentTags = extractAllTechTags(result);
  const currentCount = new Map<string, number>();
  for (const t of currentTags) currentCount.set(t, (currentCount.get(t) || 0) + 1);

  for (const t of origTags) {
    const n = currentCount.get(t) || 0;
    if (n <= 0) {
      // Tag is missing — re-append at end
      result = `${result.trimEnd()} ${t}`.trim();
    } else {
      currentCount.set(t, n - 1);
    }
  }

  return result.replace(/\s{2,}/g, ' ').trim();
}

/** Extract all technical tags from text (unified pattern) */
function extractAllTechTags(text: string): string[] {
  const TECH_TAG_REGEX = /[\uFFF9-\uFFFC]|[\uE000-\uE0FF]+|\$\w+\([^)]*\)|\$\w+|%[sd]|\[\s*M[A-Z]*ID_[^\]]+\]|\[\s*\w+\s*:[^\]]*?\s*\]|\[\s*\w+\s*=\s*\w[^\]]*\]|\{\s*\w+\s*:\s*\w[^}]*\}|\{\/\w+\}|\{[\w]+\}|<[\w\/][^>]*>|[ɣɐɓɑɔɛɜɞɤɥɨɪɯɵɶʀʁʂʃʄʇʈ]/g;
  return [...text.matchAll(TECH_TAG_REGEX)].map(m => m[0]);
}
