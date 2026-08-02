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

const MIN_LEN = 3;

function isPrintableAscii(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
}

/** Heuristic: does the decoded chunk look like real game text? */
function looksLikeText(s: string): boolean {
  if (s.trim().length < MIN_LEN) return false;
  const letters = s.replace(/[^A-Za-z\u3000-\u9fff\uff00-\uffef]/g, "").length;
  return letters / s.length >= 0.4;
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
  let start = -1;

  const flush = (end: number) => {
    if (start < 0) return;
    const len = end - start;
    if (len >= MIN_LEN) {
      const slice = data.subarray(start, end);
      let text: string | null = null;
      try {
        text = utf8.decode(slice);
      } catch {
        text = sjis ? sjis.decode(slice) : null;
      }
      if (text && looksLikeText(text)) {
        out.push({ offset: start, maxBytes: len, text });
      }
    }
    start = -1;
  };

  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    // ASCII printable or high bytes (UTF-8 / Shift-JIS lead bytes)
    if (isPrintableAscii(b) || b >= 0x80) {
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