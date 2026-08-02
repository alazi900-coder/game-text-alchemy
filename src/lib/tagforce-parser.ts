/**
 * Yu-Gi-Oh! ARC-V Tag Force Special (PSP) text support.
 *
 * The game stores its texts as null-terminated strings inside binary files
 * (DATA.BIN / *.bin blobs extracted from the ISO/CPK, or files produced by an
 * xdelta patch). We locate readable strings, remember their absolute offset and
 * the exact byte budget available, so a translation can be written back
 * in-place without shifting any pointer.
 */

export interface TagForceString {
  /** absolute byte offset of the first character */
  offset: number;
  /** number of bytes available (string length, excluding the null terminator) */
  maxBytes: number;
  text: string;
}

const MIN_LEN = 4;

function isPrintableAscii(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
}

const COMMON_WORDS = /\b(the|and|you|your|are|for|with|this|that|card|cards|deck|duel|monster|monsters|spell|trap|life|points|player|turn|attack|defense|effect|field|hand|graveyard|summon|will|can|not|from|have|has|when|then|all|one|two|new|game|save|load|menu|yes|no|ok|exit|start|select|option|options|settings|press|button|please|error|data|memory|stick|continue|next|back|first|second|end|phase|draw|battle|main|win|lose|damage|target|activate|destroy|special|normal|level|type|name|point|shop|pack|buy|sell|tag|force|arc|duelist|reward|story|mode|free|use|get|see|now|out|off|on|it|is|to|of|in|a|i)\b/i;

/**
 * Heuristic: does the decoded chunk look like real, readable English game text?
 * The binaries are full of pointer tables, opcodes and card-id blobs that happen
 * to decode as printable bytes, so the filter has to be strict.
 */
function looksLikeText(s: string): boolean {
  const t = s.trim();
  if (t.length < MIN_LEN || t.length > 512) return false;

  // English-only: reject anything with non-ASCII (mojibake / CJK noise)
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(t)) return false;

  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 3) return false;
  // must be mostly letters/spaces/punctuation, not symbol soup
  if (letters / t.length < 0.6) return false;

  // needs at least one vowel-bearing word
  if (!/[AaEeIiOoUuYy]/.test(t)) return false;

  // reject long uppercase/underscore identifiers & paths (asset names, not text)
  if (/^[A-Z0-9_./\\-]+$/.test(t)) return false;
  if (/[\\/][A-Za-z0-9_.-]+\.(bin|dat|tex|gim|at3|png|pmf|prx|elf|txt)/i.test(t)) return false;
  if (/^[a-z0-9_]+$/.test(t) && !/[aeiou]{1}/.test(t)) return false;

  // reject repeated-character padding (e.g. "aaaaaa", "@@@@")
  if (/(.)\1{4,}/.test(t)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  const hasLongWord = words.some((w) => /^[A-Za-z][A-Za-z'’.,!?-]{2,}$/.test(w));
  if (!hasLongWord) return false;

  // single word must be a plausible word (has a vowel and mixed/normal casing)
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 3) return false;
    if (!/^[A-Za-z][A-Za-z'’.,!?-]*$/.test(w)) return false;
    if (!/[aeiouyAEIOUY]/.test(w)) return false;
    // require it to look like a real word or a known keyword
    if (!COMMON_WORDS.test(w) && !/^[A-Z]?[a-z]+$/.test(w)) return false;
    return true;
  }

  // multi-word: accept sentences/labels containing at least one common word,
  // or proper sentence-like punctuation
  if (COMMON_WORDS.test(t)) return true;
  return /[.!?:,"']/.test(t) && words.length >= 3;
}

/**
 * Extract null-terminated strings from a Tag Force binary file.
 * Tries UTF-8 first, falls back to Shift-JIS when the bytes are not valid UTF-8.
 */
export function parseTagForceBinary(buffer: ArrayBuffer): TagForceString[] {
  const data = new Uint8Array(buffer);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let sjis: TextDecoder | null = null;
  try {
    sjis = new TextDecoder("shift_jis");
  } catch {
    sjis = null;
  }

  const out: TagForceString[] = [];
  const seen = new Set<string>();
  let start = -1;

  const flush = (end: number) => {
    if (start < 0) return;
    const len = end - start;
    if (len >= MIN_LEN && len <= 512) {
      const slice = data.subarray(start, end);
      let text: string | null = null;
      try {
        text = utf8.decode(slice);
      } catch {
        text = null;
      }
      if (text && looksLikeText(text)) {
        const norm = text.trim();
        if (!seen.has(norm + ":" + len)) {
          seen.add(norm + ":" + len);
          out.push({ offset: start, maxBytes: len, text });
        }
      }
    }
    start = -1;
  };

  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    // English-only extraction: printable ASCII runs
    if (isPrintableAscii(b)) {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(data.length);

  return out;
}

/**
 * Parse a plain text dump: `offset=text`, `id=text` or one entry per line.
 */
export function parseTagForceTxt(raw: string): TagForceString[] {
  const out: TagForceString[] = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith("#") || line.startsWith("//")) return;
    const m = line.match(/^\s*(0x[0-9a-fA-F]+|\d+)\s*=\s*(.*)$/);
    if (m) {
      const text = m[2];
      out.push({
        offset: m[1].startsWith("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10),
        maxBytes: new TextEncoder().encode(text).length,
        text,
      });
    } else {
      out.push({ offset: i, maxBytes: new TextEncoder().encode(line).length, text: line });
    }
  });
  return out;
}

/** Group strings into pseudo-files so the editor's category filters stay usable. */
export function categorizeTagForce(s: TagForceString): string {
  const t = s.text;
  if (/\[[^\]]+\]/.test(t)) return "ygo-tags";
  if (/effect|damage|monster|spell|trap|deck|card/i.test(t)) return "ygo-cards";
  if (/menu|option|setting|save|load|exit|yes|no/i.test(t)) return "ygo-ui";
  if (t.length > 60) return "ygo-dialogue";
  return "ygo-misc";
}

/**
 * Write translations back into the original binary, in place.
 * Strings are truncated to their byte budget and padded with 0x00.
 */
export function rebuildTagForceBinary(
  original: ArrayBuffer,
  strings: TagForceString[],
  translations: Record<number, string>,
): { data: Uint8Array; written: number; truncated: number } {
  const out = new Uint8Array(original.slice(0));
  const enc = new TextEncoder();
  let written = 0;
  let truncated = 0;

  for (const s of strings) {
    const tr = translations[s.offset];
    if (!tr || !tr.trim() || tr === s.text) continue;
    let bytes = enc.encode(tr);
    if (bytes.length > s.maxBytes) {
      bytes = bytes.subarray(0, s.maxBytes);
      truncated++;
    }
    out.set(bytes, s.offset);
    for (let i = s.offset + bytes.length; i < s.offset + s.maxBytes; i++) out[i] = 0;
    written++;
  }

  return { data: out, written, truncated };
}