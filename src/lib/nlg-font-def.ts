/**
 * NLG Font Definition Parser/Builder
 * 
 * Parses and generates the text-based font definition found inside
 * Luigi's Mansion 2 HD NLG font archives (FEBundleFonts_res.data).
 * 
 * Format:
 *   Font "NAME" SIZE color R G B
 *   PageSize N PageCount N TextType color Distribution english
 *   Height N RenderHeight N Ascent N RenderAscent N IL N
 *   CharSpacing N LineHeight N
 *   Glyph CHAR Width W RW XOFF X1 Y1 X2 Y2 PAGE
 *   ...
 */

export interface NLGFontHeader {
  fontName: string;
  fontSize: number;
  colorR: number;
  colorG: number;
  colorB: number;
  pageSize: number;
  pageCount: number;
  textType: string;
  distribution: string;
  height: number;
  renderHeight: number;
  ascent: number;
  renderAscent: number;
  il: number;
  charSpacing: number;
  lineHeight: number;
}

export interface NLGGlyphEntry {
  /** Character spec — single char or decimal code */
  charSpec: string;
  /** Unicode code point */
  code: number;
  /** Display width */
  width: number;
  /** Render width */
  renderWidth: number;
  /** X offset */
  xOffset: number;
  /** Left X on atlas */
  x1: number;
  /** Top Y on atlas */
  y1: number;
  /** Right X on atlas */
  x2: number;
  /** Bottom Y on atlas */
  y2: number;
  /** Texture page index */
  page: number;
}

export interface NLGFontDef {
  header: NLGFontHeader;
  glyphs: NLGGlyphEntry[];
  /** Raw text for round-trip fidelity */
  rawText: string;
}

/**
 * Parse the font definition text from the NLG archive.
 */
export function parseNLGFontDef(text: string): NLGFontDef {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  const header: NLGFontHeader = {
    fontName: "Unknown", fontSize: 15,
    colorR: 255, colorG: 255, colorB: 255,
    pageSize: 1024, pageCount: 2, textType: "color", distribution: "english",
    height: 25, renderHeight: 32, ascent: 26, renderAscent: 26, il: 10,
    charSpacing: 0, lineHeight: 0,
  };

  const glyphs: NLGGlyphEntry[] = [];

  for (const line of lines) {
    if (line.startsWith('Font ')) {
      const m = line.match(/^Font\s+\"([^\"]+)\"\s+(\d+)\s+color\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (m) {
        header.fontName = m[1];
        header.fontSize = parseInt(m[2]);
        header.colorR = parseInt(m[3]);
        header.colorG = parseInt(m[4]);
        header.colorB = parseInt(m[5]);
      }
    } else if (line.startsWith('PageSize ')) {
      const m = line.match(/PageSize\s+(\d+)\s+PageCount\s+(\d+)\s+TextType\s+(\w+)\s+Distribution\s+(\w+)/);
      if (m) {
        header.pageSize = parseInt(m[1]);
        header.pageCount = parseInt(m[2]);
        header.textType = m[3];
        header.distribution = m[4];
      }
    } else if (line.startsWith('Height ')) {
      const m = line.match(/Height\s+(\d+)\s+RenderHeight\s+(\d+)\s+Ascent\s+(\d+)\s+RenderAscent\s+(\d+)\s+IL\s+(\d+)/);
      if (m) {
        header.height = parseInt(m[1]);
        header.renderHeight = parseInt(m[2]);
        header.ascent = parseInt(m[3]);
        header.renderAscent = parseInt(m[4]);
        header.il = parseInt(m[5]);
      }
    } else if (line.startsWith('CharSpacing ')) {
      const m = line.match(/CharSpacing\s+(-?\d+)\s+LineHeight\s+(-?\d+)/);
      if (m) {
        header.charSpacing = parseInt(m[1]);
        header.lineHeight = parseInt(m[2]);
      }
    } else if (line.startsWith('Glyph ')) {
      const parts = line.split(/\s+/);
      // Glyph CHAR Width W RW XOFF X1 Y1 X2 Y2 PAGE
      if (parts.length >= 11) {
        const charSpec = parts[1];
        // parts[2] is "Width"
        const width = parseInt(parts[3]);
        const renderWidth = parseInt(parts[4]);
        const xOffset = parseInt(parts[5]);
        const x1 = parseInt(parts[6]);
        const y1 = parseInt(parts[7]);
        const x2 = parseInt(parts[8]);
        const y2 = parseInt(parts[9]);
        const page = parseInt(parts[10]);

        let code: number;
        if (charSpec.length === 1) {
          code = charSpec.codePointAt(0)!;
        } else {
          code = parseInt(charSpec);
        }

        glyphs.push({ charSpec, code, width, renderWidth, xOffset, x1, y1, x2, y2, page });
      }
    }
  }

  return { header, glyphs, rawText: text };
}

/**
 * Serialize font definition back to NLG text format.
 */
export function serializeNLGFontDef(def: NLGFontDef): string {
  const h = def.header;
  const lines: string[] = [];

  lines.push(`Font "${h.fontName}" ${h.fontSize} color ${h.colorR} ${h.colorG} ${h.colorB}`);
  lines.push(`PageSize ${h.pageSize} PageCount ${h.pageCount} TextType ${h.textType} Distribution ${h.distribution}`);
  lines.push(`Height ${h.height} RenderHeight ${h.renderHeight} Ascent ${h.ascent} RenderAscent ${h.renderAscent} IL ${h.il}`);
  lines.push(`CharSpacing ${h.charSpacing} LineHeight ${h.lineHeight}`);

  for (const g of def.glyphs) {
    lines.push(`Glyph ${g.charSpec} Width ${g.width} ${g.renderWidth} ${g.xOffset} ${g.x1} ${g.y1} ${g.x2} ${g.y2} ${g.page}`);
  }

  return '\n' + lines.join('\r\n') + '\r\n';
}

/**
 * Find and extract the font definition text from raw .data bytes.
 * Searches for the "Font " marker after all DDS textures.
 */
export function findFontDefInData(data: Uint8Array): { text: string; offset: number; length: number } | null {
  // Search for '\nFont "' or 'Font "' pattern in the tail of the data
  const searchStart = Math.max(0, data.length - 200000); // Only search last 200KB
  
  for (let i = searchStart; i < data.length - 10; i++) {
    // Look for 'Font "' preceded by newline or at start
    if (data[i] === 0x0A && data[i + 1] === 0x46 && data[i + 2] === 0x6F &&
        data[i + 3] === 0x6E && data[i + 4] === 0x74 && data[i + 5] === 0x20 &&
        data[i + 6] === 0x22) {
      // Found '\nFont "' — the font def starts at i (including the \n)
      // Find end — look for first null byte
      let end = i;
      while (end < data.length && data[end] !== 0x00) end++;
      
      const text = new TextDecoder('ascii').decode(data.slice(i, end));
      return { text, offset: i, length: end - i };
    }
  }

  // Try without leading newline
  for (let i = searchStart; i < data.length - 10; i++) {
    if (data[i] === 0x46 && data[i + 1] === 0x6F && data[i + 2] === 0x6E &&
        data[i + 3] === 0x6E && data[i + 4] === 0x74 && data[i + 5] === 0x20 &&
        data[i + 6] === 0x22) {
      let end = i;
      while (end < data.length && data[end] !== 0x00) end++;
      const text = new TextDecoder('ascii').decode(data.slice(i, end));
      return { text, offset: i, length: end - i };
    }
  }

  return null;
}

/**
 * Generate NLG glyph entries from atlas result for Arabic characters.
 * Maps atlas coordinates to the NLG Glyph format.
 */
export function generateArabicGlyphEntries(
  atlasGlyphs: Array<{
    char: string;
    code: number;
    atlasX: number;
    atlasY: number;
    width: number;
    height: number;
    advance: number;
    bearingX: number;
    page: number;
  }>,
  basePageIndex: number,
  renderHeight: number,
): NLGGlyphEntry[] {
  const entries: NLGGlyphEntry[] = [];

  for (const g of atlasGlyphs) {
    if (g.width === 0) continue;

    const charSpec = g.code.toString(); // Use decimal code for non-ASCII
    
    entries.push({
      charSpec,
      code: g.code,
      width: g.advance,
      renderWidth: Math.max(g.advance, g.width + Math.abs(g.bearingX)),
      xOffset: Math.max(0, g.bearingX),
      x1: g.atlasX,
      y1: g.atlasY,
      x2: g.atlasX + g.width,
      y2: g.atlasY + g.height,
      page: basePageIndex + g.page,
    });
  }

  return entries;
}

/**
 * Merge Arabic glyph entries into an existing font definition.
 * Removes any existing Arabic entries (code >= 0x0600) and adds new ones.
 * Updates PageCount in the header.
 */
export function mergeArabicIntoFontDef(
  fontDef: NLGFontDef,
  arabicEntries: NLGGlyphEntry[],
  totalPageCount: number,
): NLGFontDef {
  // Remove existing Arabic glyphs (U+0600+ range, excluding existing Latin Extended)
  const existingGlyphs = fontDef.glyphs.filter(g => {
    // Keep all non-Arabic glyphs
    return g.code < 0x0600 || (g.code >= 0xFB00 && g.code <= 0xFB06); // Keep Latin ligatures
  });

  // Also remove any previously injected Arabic presentation forms
  const cleanGlyphs = existingGlyphs.filter(g => {
    return !(g.code >= 0x0600 && g.code <= 0x06FF) && // Arabic
           !(g.code >= 0xFB50 && g.code <= 0xFDFF) && // Arabic Presentation A
           !(g.code >= 0xFE70 && g.code <= 0xFEFF);   // Arabic Presentation B
  });

  // Sort: existing glyphs by code, then Arabic entries
  const allGlyphs = [...cleanGlyphs, ...arabicEntries];
  allGlyphs.sort((a, b) => a.code - b.code);

  return {
    header: {
      ...fontDef.header,
      pageCount: totalPageCount,
    },
    glyphs: allGlyphs,
    rawText: '', // Will be regenerated
  };
}

/**
 * Inject updated font definition text back into the .data buffer.
 * Handles size changes by adjusting the buffer.
 */
export function injectFontDefIntoData(
  originalData: Uint8Array,
  newFontDefText: string,
  originalOffset: number,
  originalLength: number,
): Uint8Array {
  const newBytes = new TextEncoder().encode(newFontDefText);
  
  const sizeDiff = newBytes.length - originalLength;
  const newData = new Uint8Array(originalData.length + sizeDiff);
  
  // Copy everything before font def
  newData.set(originalData.slice(0, originalOffset), 0);
  
  // Write new font def
  newData.set(newBytes, originalOffset);
  
  // Copy everything after original font def (padding/footer)
  const afterOriginal = originalOffset + originalLength;
  if (afterOriginal < originalData.length) {
    newData.set(originalData.slice(afterOriginal), originalOffset + newBytes.length);
  }
  
  return newData;
}
