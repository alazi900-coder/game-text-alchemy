import pako from "pako";

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

/**
 * Allow printable ASCII and non-control characters (which could be UTF-8 or Shift-JIS)
 */
function isPrintable(b: number): boolean {
  // Allow common whitespace: TAB, LF, CR
  if (b === 0x09 || b === 0x0a || b === 0x0d) return true;
  // Reject control characters 0x00-0x1F and 0x7F
  if (b < 0x20 || b === 0x7f) return false;
  // Allow everything else (0x80-0xFF) as they might be part of Multi-byte encodings
  return true;
}

const COMMON_WORDS = /\b(the|and|you|your|are|for|with|this|that|card|cards|deck|duel|monster|monsters|spell|trap|life|points|player|turn|attack|defense|effect|field|hand|graveyard|summon|will|can|not|from|have|has|when|then|all|one|two|new|game|save|load|menu|yes|no|ok|exit|start|select|option|options|settings|press|button|please|error|data|memory|stick|continue|next|back|first|second|end|phase|draw|battle|main|win|lose|damage|target|activate|destroy|special|normal|level|type|name|point|shop|pack|buy|sell|tag|force|arc|duelist|reward|story|mode|free|use|get|see|now|out|off|on|it|is|to|of|in|a|i)\b/i;

/**
 * Heuristic: does the decoded chunk look like real, readable game text?
 * Binary files are full of pointer tables and opcodes that can decode as
 * printable bytes, so we filter strictly.
 */
function looksLikeText(s: string): boolean {
  const t = s.trim();
  if (t.length < MIN_LEN || t.length > 1024) return false;

  // Reject strings that are mostly numbers or punctuation (likely not text)
  const letters = (t.match(/[\p{L}]/gu) || []).length;
  if (letters / t.length < 0.4 && t.length > 10) return false;

  // Reject repeated-character padding (e.g. "aaaaaa", "@@@@")
  if (/(.)\1{5,}/.test(t)) return false;

  // Reject common binary patterns: identifiers like "ASSET_01_BG" are often mixed with text
  // but if it's ONLY uppercase/underscore/digits and long, it's likely an internal ID
  if (t.length > 8 && /^[A-Z0-9_]+$/.test(t) && !COMMON_WORDS.test(t)) return false;
  
  // Reject common file paths/extensions if they are the ONLY thing
  if (/\.(bin|dat|tex|gim|at3|png|pmf|prx|elf|txt|vag|res)$/i.test(t) && !t.includes(" ")) return false;

  // If it's pure ASCII, check for English-like structure or common words
  if (/^[\x20-\x7e\s]+$/.test(t)) {
    // English-specific heuristics
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      const w = words[0];
      if (w.length < 3) return false;
      // Single word should have at least one vowel
      if (!/[aeiouyAEIOUY]/.test(w) && !/^[A-Z0-9]+$/.test(w)) return false;
    }
  }

  return true;
}

/**
 * Extract strings from binary. Supports Zlib decompression and Shift-JIS fallback.
 */
export function parseTagForceBinary(buffer: ArrayBuffer): TagForceString[] {
  let rawData = new Uint8Array(buffer);
  
  // --- Decompression Layer ---
  // Detect Zlib (0x78 + 0x01/0x9C/0xDA)
  if (rawData.length > 4 && rawData[0] === 0x78 && (rawData[1] === 0x01 || rawData[1] === 0x9C || rawData[1] === 0xDA)) {
    try {
      rawData = pako.inflate(rawData);
    } catch (e) {
      console.warn("Found Zlib header but decompression failed - reading as raw", e);
    }
  }

  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const sjis = new TextDecoder("shift-jis", { fatal: true });

  const out: TagForceString[] = [];
  const seen = new Set<string>();
  let start = -1;

  const flush = (end: number) => {
    if (start < 0) return;
    const len = end - start;
    if (len >= MIN_LEN && len <= 1024) {
      const slice = rawData.subarray(start, end);
      let text: string | null = null;
      
      // Try UTF-8 first
      try {
        text = utf8.decode(slice);
      } catch {
        // Fallback to Shift-JIS (Common for Japanese PSP games)
        try {
          text = sjis.decode(slice);
        } catch {
          text = null;
        }
      }

      if (text && looksLikeText(text)) {
        const norm = text.trim();
        // Use normalized text + length as uniqueness key to allow same text at different offsets
        // but avoid immediate duplicates from carver noise
        const key = `${norm}:${len}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ offset: start, maxBytes: len, text });
        }
      }
    }
    start = -1;
  };

  for (let i = 0; i < rawData.length; i++) {
    const b = rawData[i];
    if (isPrintable(b)) {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(rawData.length);

  return out;
}

/**
 * Parse a plain text dump: `offset=text` or `id=text`.
 */
export function parseTagForceTxt(raw: string): TagForceString[] {
  const out: TagForceString[] = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return;
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

export function categorizeTagForce(s: TagForceString): string {
  const t = s.text;
  if (/\[[^\]]+\]/.test(t)) return "ygo-tags";
  if (/effect|damage|monster|spell|trap|deck|card|召唤|特殊|魔法|罠|カード/i.test(t)) return "ygo-cards";
  if (/menu|option|setting|save|load|exit|yes|no|はい|いいえ|セーブ|ロード/i.test(t)) return "ygo-ui";
  if (t.length > 60 || /[。！？…]$/.test(t)) return "ygo-dialogue";
  return "ygo-misc";
}

/**
 * Write translations back into the original binary.
 * NOTE: If the file was decompressed during import, re-injection into the 
 * ORIGINAL (compressed) file is not possible without re-compression.
 * This function currently writes to the provided buffer (uncompressed).
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
    
    // Check if the original string was Shift-JIS or UTF-8
    // For simplicity, we write back UTF-8 if the game supports it, 
    // but Tag Force often needs Shift-JIS for Japanese text.
    // However, for an Arabic translation, UTF-8 is usually required 
    // unless the game font was hacked to replace Shift-JIS chars.
    let bytes = enc.encode(tr);
    if (bytes.length > s.maxBytes) {
      bytes = bytes.subarray(0, s.maxBytes);
      truncated++;
    }
    out.set(bytes, s.offset);
    // Null-terminate the rest of the budget
    for (let i = s.offset + bytes.length; i < s.offset + s.maxBytes; i++) {
      out[i] = 0;
    }
    written++;
  }

  return { data: out, written, truncated };
}
