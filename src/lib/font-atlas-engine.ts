/**
 * Font Atlas Engine — Advanced glyph measurement, bin-packing, and atlas generation.
 * 
 * Measures exact glyph bounding boxes from Canvas2D rendering,
 * packs them efficiently using a shelf-based bin-packing algorithm,
 * and generates texture atlases with proper metrics for game engine consumption.
 */

export interface GlyphMetrics {
  /** The character string */
  char: string;
  /** Unicode code point */
  code: number;
  /** X position on the atlas texture */
  atlasX: number;
  /** Y position on the atlas texture */
  atlasY: number;
  /** Width of the glyph bitmap (tight) */
  width: number;
  /** Height of the glyph bitmap (tight) */
  height: number;
  /** Horizontal bearing — offset from pen position to left edge of glyph */
  bearingX: number;
  /** Vertical bearing — offset from baseline to top edge of glyph */
  bearingY: number;
  /** Horizontal advance — total pen movement after rendering this glyph */
  advance: number;
  /** Atlas page index */
  page: number;
}

export interface AtlasPage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface AtlasResult {
  pages: AtlasPage[];
  glyphs: GlyphMetrics[];
  /** Font ascent in pixels */
  ascent: number;
  /** Font descent in pixels */
  descent: number;
  /** Line height in pixels */
  lineHeight: number;
  /** Font size used */
  fontSize: number;
  /** Atlas texture size */
  textureSize: number;
}

interface ShelfRow {
  y: number;
  height: number;
  xCursor: number;
}

/**
 * Measure a single glyph's tight bounding box and metrics by rendering to an offscreen canvas.
 */
function measureGlyph(
  char: string,
  ctx: CanvasRenderingContext2D,
  measureCanvas: HTMLCanvasElement,
  fontSize: number,
  padding: number,
): {
  width: number;
  height: number;
  bearingX: number;
  bearingY: number;
  advance: number;
  imageData: ImageData | null;
} {
  const cw = measureCanvas.width;
  const ch = measureCanvas.height;
  ctx.clearRect(0, 0, cw, ch);

  // Draw at center of measure canvas
  const drawX = Math.floor(cw / 3);
  const drawY = Math.floor(ch * 0.7);
  ctx.fillText(char, drawX, drawY);

  const textMetrics = ctx.measureText(char);
  const advance = Math.ceil(textMetrics.width);

  // Read pixels and find tight bounding box
  const imgData = ctx.getImageData(0, 0, cw, ch);
  const data = imgData.data;

  let minX = cw, minY = ch, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const alpha = data[(y * cw + x) * 4 + 3];
      if (alpha > 2) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) {
    return { width: 0, height: 0, bearingX: 0, bearingY: 0, advance, imageData: null };
  }

  // Add padding
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(cw - 1, maxX + padding);
  maxY = Math.min(ch - 1, maxY + padding);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // Extract tight bounding box image data
  const tightData = ctx.getImageData(minX, minY, w, h);

  // bearingX = how far left of pen position the glyph starts
  const bearingX = minX - drawX;
  // bearingY = how far above the pen baseline the glyph extends
  const bearingY = drawY - minY;

  return {
    width: w,
    height: h,
    bearingX,
    bearingY,
    advance,
    imageData: tightData,
  };
}

/**
 * Generate a font atlas with proper glyph metrics using shelf bin-packing.
 */
export function generateFontAtlas(options: {
  chars: { char: string; code: number }[];
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  textureSize: number;
  padding?: number;
  color?: string;
  strokeWidth?: number;
  strokeColor?: string;
  antiAlias?: boolean;
}): AtlasResult {
  const {
    chars,
    fontFamily,
    fontSize,
    fontWeight = "400",
    textureSize,
    padding = 2,
    color = "#ffffff",
    strokeWidth = 0,
    strokeColor = "#000000",
    antiAlias = true,
  } = options;

  // Create measurement canvas (large enough for any single glyph)
  const measureSize = Math.max(256, fontSize * 4);
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = measureSize;
  measureCanvas.height = measureSize;
  const measureCtx = measureCanvas.getContext("2d", { willReadFrequently: true })!;
  measureCtx.imageSmoothingEnabled = antiAlias;
  measureCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Tajawal", "Noto Sans Arabic", sans-serif`;
  measureCtx.fillStyle = color;
  measureCtx.textBaseline = "alphabetic";
  measureCtx.textAlign = "left";

  if (strokeWidth > 0) {
    measureCtx.strokeStyle = strokeColor;
    measureCtx.lineWidth = strokeWidth;
    measureCtx.lineJoin = "round";
  }

  // Measure font-level metrics
  const sampleMetrics = measureCtx.measureText("Aبgj");
  const ascent = Math.ceil(sampleMetrics.actualBoundingBoxAscent || fontSize * 0.8);
  const descent = Math.ceil(sampleMetrics.actualBoundingBoxDescent || fontSize * 0.2);
  const lineHeight = ascent + descent + padding * 2;

  // Phase 1: Measure all glyphs
  interface MeasuredGlyph {
    char: string;
    code: number;
    width: number;
    height: number;
    bearingX: number;
    bearingY: number;
    advance: number;
    imageData: ImageData | null;
  }

  const measured: MeasuredGlyph[] = [];
  for (const c of chars) {
    // Reset font each time (some browsers lose it after clearRect)
    measureCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Tajawal", "Noto Sans Arabic", sans-serif`;
    measureCtx.fillStyle = color;
    measureCtx.textBaseline = "alphabetic";
    measureCtx.textAlign = "left";

    const m = measureGlyph(c.char, measureCtx, measureCanvas, fontSize, padding);
    measured.push({
      char: c.char,
      code: c.code,
      ...m,
    });
  }

  // Sort by height descending for better shelf packing
  const sortedIndices = measured
    .map((_, i) => i)
    .sort((a, b) => (measured[b].height || 0) - (measured[a].height || 0));

  // Phase 2: Shelf bin-packing
  const pages: AtlasPage[] = [];
  const glyphs: GlyphMetrics[] = new Array(measured.length);
  const shelves: { page: number; rows: ShelfRow[] }[] = [];

  const spacing = padding + 1; // spacing between glyphs in atlas

  function createNewPage(): number {
    const canvas = document.createElement("canvas");
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, textureSize, textureSize);
    pages.push({ canvas, ctx });
    shelves.push({ page: pages.length - 1, rows: [] });
    return pages.length - 1;
  }

  function findOrCreateShelf(w: number, h: number): { page: number; x: number; y: number } | null {
    // Try to fit in an existing shelf
    for (const shelf of shelves) {
      for (const row of shelf.rows) {
        if (row.height >= h && row.xCursor + w + spacing <= textureSize) {
          const x = row.xCursor;
          row.xCursor += w + spacing;
          return { page: shelf.page, x, y: row.y };
        }
      }
    }

    // Try to add a new shelf on an existing page
    for (const shelf of shelves) {
      const lastRow = shelf.rows[shelf.rows.length - 1];
      const newY = lastRow ? lastRow.y + lastRow.height + spacing : spacing;
      if (newY + h + spacing <= textureSize) {
        shelf.rows.push({ y: newY, height: h, xCursor: w + spacing + spacing });
        return { page: shelf.page, x: spacing, y: newY };
      }
    }

    // Create a new page
    const pageIdx = createNewPage();
    shelves[shelves.length - 1].rows.push({
      y: spacing,
      height: h,
      xCursor: w + spacing + spacing,
    });
    return { page: pageIdx, x: spacing, y: spacing };
  }

  // Phase 3: Pack and render glyphs
  for (const idx of sortedIndices) {
    const m = measured[idx];
    if (!m.imageData || m.width === 0) {
      // Empty glyph (e.g., space)
      glyphs[idx] = {
        char: m.char,
        code: m.code,
        atlasX: 0,
        atlasY: 0,
        width: 0,
        height: 0,
        bearingX: 0,
        bearingY: 0,
        advance: m.advance || Math.ceil(fontSize * 0.3),
        page: 0,
      };
      continue;
    }

    const pos = findOrCreateShelf(m.width, m.height);
    if (!pos) {
      // Should never happen since we always create new pages
      continue;
    }

    // Render glyph onto atlas page
    const page = pages[pos.page];
    page.ctx.putImageData(m.imageData, pos.x, pos.y);

    glyphs[idx] = {
      char: m.char,
      code: m.code,
      atlasX: pos.x,
      atlasY: pos.y,
      width: m.width,
      height: m.height,
      bearingX: m.bearingX,
      bearingY: m.bearingY,
      advance: m.advance,
      page: pos.page,
    };
  }

  // Ensure at least one page
  if (pages.length === 0) createNewPage();

  return {
    pages,
    glyphs: glyphs.filter(Boolean),
    ascent,
    descent,
    lineHeight,
    fontSize,
    textureSize,
  };
}

/**
 * Render a preview of Arabic text using atlas metrics (simulates game engine rendering).
 */
export function renderTextPreview(
  ctx: CanvasRenderingContext2D,
  text: string,
  atlasResult: AtlasResult,
  x: number,
  y: number,
  scale: number = 1,
  rtl: boolean = true,
): void {
  const glyphMap = new Map<number, GlyphMetrics>();
  for (const g of atlasResult.glyphs) {
    glyphMap.set(g.code, g);
  }

  const lines = text.split("\n");
  let penY = y;

  for (const line of lines) {
    // For RTL, we need to reverse render order
    const codePoints = [...line].map(c => c.codePointAt(0)!);
    if (rtl) codePoints.reverse();

    let penX = rtl ? x : x;

    for (const cp of codePoints) {
      const glyph = glyphMap.get(cp);
      if (!glyph || glyph.width === 0) {
        penX += (glyph?.advance || atlasResult.fontSize * 0.3) * scale;
        continue;
      }

      const page = atlasResult.pages[glyph.page];
      if (!page) continue;

      // Draw from atlas to preview
      const drawX = penX + glyph.bearingX * scale;
      const drawY = penY - glyph.bearingY * scale;

      ctx.drawImage(
        page.canvas,
        glyph.atlasX, glyph.atlasY, glyph.width, glyph.height,
        drawX, drawY, glyph.width * scale, glyph.height * scale,
      );

      penX += glyph.advance * scale;
    }

    penY += atlasResult.lineHeight * scale;
  }
}

/**
 * Export glyph metrics as JSON compatible with common game engine formats.
 * Follows BMFont-like structure.
 */
export function exportMetricsJSON(atlas: AtlasResult): string {
  const output = {
    info: {
      face: "ArabicFont",
      size: atlas.fontSize,
      bold: 0,
      italic: 0,
      charset: "arabic",
      unicode: 1,
      stretchH: 100,
      smooth: 1,
      aa: 1,
      padding: [0, 0, 0, 0],
      spacing: [1, 1],
    },
    common: {
      lineHeight: atlas.lineHeight,
      base: atlas.ascent,
      scaleW: atlas.textureSize,
      scaleH: atlas.textureSize,
      pages: atlas.pages.length,
      packed: 0,
    },
    pages: atlas.pages.map((_, i) => ({ id: i, file: `atlas_page_${i}.dds` })),
    chars: atlas.glyphs.map(g => ({
      id: g.code,
      char: g.char,
      x: g.atlasX,
      y: g.atlasY,
      width: g.width,
      height: g.height,
      xoffset: g.bearingX,
      yoffset: atlas.ascent - g.bearingY,
      xadvance: g.advance,
      page: g.page,
      chnl: 15,
    })),
    kernings: [],
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Merge generated Arabic atlas pages into the original font data buffer.
 * Encodes each page as DXT5 and appends/replaces in the .data file.
 */
export function mergeAtlasToFontData(
  originalData: Uint8Array,
  atlasPages: AtlasPage[],
  existingDDSPositions: number[],
  textureSize: number,
  encodeDXT5Fn: (rgba: Uint8Array, w: number, h: number) => Uint8Array,
  ddsHeaderSize: number,
): Uint8Array {
  // For each generated atlas page, we need to encode as DXT5
  // and either replace an existing DDS or append new ones
  
  const encoded: Uint8Array[] = [];
  for (const page of atlasPages) {
    const imgData = page.ctx.getImageData(0, 0, textureSize, textureSize);
    const rgba = new Uint8Array(imgData.data.buffer);
    encoded.push(encodeDXT5Fn(rgba, textureSize, textureSize));
  }

  // Replace existing DDS textures that have been modified
  const result = new Uint8Array(originalData);
  const dxtMip0Size = textureSize * textureSize; // DXT5 for 1024x1024

  for (let i = 0; i < Math.min(encoded.length, existingDDSPositions.length); i++) {
    const writeOff = existingDDSPositions[i] + ddsHeaderSize;
    for (let b = 0; b < Math.min(encoded[i].length, dxtMip0Size); b++) {
      result[writeOff + b] = encoded[i][b];
    }
  }

  return result;
}
