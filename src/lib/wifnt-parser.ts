/**
 * WIFNT (LAFT) Font Parser for Xenoblade Chronicles 3
 * 
 * The font texture is stored as a Mibl (LBIM) image with Tegra X1 swizzling.
 * The Mibl footer (40 bytes, ending with "LBIM" magic) is at the end of the file
 * and contains the actual format, dimensions, etc.
 */

export interface WifntInfo {
  fileSize: number;
  magic: string;
  valid: boolean;
  // Texture atlas info
  textureWidth: number;
  textureHeight: number;
  gridCols: number;
  gridRows: number;
  cellWidth: number;
  cellHeight: number;
  glyphCount: number;
  // Header data
  headerSize: number;
  textureDataOffset: number;
  textureDataSize: number;
  // Mibl footer info
  imageFormat: number; // 66=BC1, 73=BC4, etc.
  imageFormatName: string;
  // Raw header bytes for inspection
  headerHex: string;
}

// Mibl footer size
const MIBL_FOOTER_SIZE = 40;

// Image format IDs from Mibl/NVN
const FORMAT_BC1 = 66;
const FORMAT_BC4 = 73;

/**
 * Parse the Mibl footer from the last 40 bytes of the file
 */
function parseMiblFooter(data: ArrayBuffer): {
  imageSize: number;
  unk: number;
  width: number;
  height: number;
  depth: number;
  viewDimension: number;
  imageFormat: number;
  mipmapCount: number;
  version: number;
  valid: boolean;
} | null {
  if (data.byteLength < MIBL_FOOTER_SIZE) return null;
  const view = new DataView(data);
  const footerOffset = data.byteLength - MIBL_FOOTER_SIZE;
  
  // Check for "LBIM" magic at offset 36 within footer
  const m0 = view.getUint8(footerOffset + 36);
  const m1 = view.getUint8(footerOffset + 37);
  const m2 = view.getUint8(footerOffset + 38);
  const m3 = view.getUint8(footerOffset + 39);
  const magic = String.fromCharCode(m0, m1, m2, m3);
  
  if (magic !== "LBIM") return null;
  
  return {
    imageSize: view.getUint32(footerOffset, true),
    unk: view.getUint32(footerOffset + 4, true),
    width: view.getUint32(footerOffset + 8, true),
    height: view.getUint32(footerOffset + 12, true),
    depth: view.getUint32(footerOffset + 16, true),
    viewDimension: view.getUint32(footerOffset + 20, true),
    imageFormat: view.getUint32(footerOffset + 24, true),
    mipmapCount: view.getUint32(footerOffset + 28, true),
    version: view.getUint32(footerOffset + 32, true),
    valid: true,
  };
}

function getFormatName(fmt: number): string {
  switch (fmt) {
    case 1: return "R8";
    case 37: return "RGBA8";
    case 41: return "RGBA16F";
    case 57: return "RGBA4";
    case FORMAT_BC1: return "BC1 (DXT1)";
    case 67: return "BC2";
    case 68: return "BC3";
    case FORMAT_BC4: return "BC4";
    case 75: return "BC5";
    case 77: return "BC7";
    case 80: return "BC6H";
    case 109: return "BGRA8";
    default: return `Unknown (${fmt})`;
  }
}

/** Bytes per pixel/block for each format */
function getBpp(fmt: number): number {
  switch (fmt) {
    case FORMAT_BC1: return 8;
    case FORMAT_BC4: return 8;
    case 67: case 68: case 75: case 77: case 80: return 16;
    case 1: return 1;
    case 37: case 109: return 4;
    case 41: return 8;
    case 57: return 2;
    default: return 8;
  }
}

/** Is this a block-compressed format? */
function isBlockCompressed(fmt: number): boolean {
  return [FORMAT_BC1, 67, 68, FORMAT_BC4, 75, 77, 80].includes(fmt);
}

/** Round up to next power of 2 */
function pow2RoundUp(v: number): number {
  if (v <= 1) return 1;
  v--;
  v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16;
  return v + 1;
}

function divRoundUp(a: number, b: number): number {
  return Math.ceil(a / b);
}

/** Determine block_height in GOBs */
function getBlockHeight(heightInBytes: number): number {
  // height in GOB rows = height / 8
  let bh = pow2RoundUp(divRoundUp(heightInBytes, 8));
  if (bh > 16) bh = 16;
  if (bh < 1) bh = 1;
  return bh;
}

/**
 * Calculate the swizzled data size for a given surface.
 * Width/height are in pixels. For block compressed, they are converted to block dimensions.
 */
function swizzledSize(width: number, height: number, bpp: number, blockCompressed: boolean): number {
  let widthInUnits: number, heightInUnits: number;
  if (blockCompressed) {
    widthInUnits = divRoundUp(width, 4);
    heightInUnits = divRoundUp(height, 4);
  } else {
    widthInUnits = width;
    heightInUnits = height;
  }
  const byteWidth = widthInUnits * bpp;
  const gobsX = divRoundUp(byteWidth, 64);
  const blockHeight = getBlockHeight(heightInUnits);
  const gobsY = divRoundUp(heightInUnits, 8 * blockHeight);
  return gobsX * gobsY * blockHeight * 512;
}

/**
 * Analyze a WIFNT file and extract structure information
 */
export function analyzeWifnt(data: ArrayBuffer): WifntInfo {
  const bytes = new Uint8Array(data);
  
  // Read magic bytes
  const magic = data.byteLength >= 4
    ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    : "????";

  const valid = magic === "LAFT" || magic === "TFAL";

  // Extract first 64 bytes as hex for inspection
  const headerBytes = Math.min(64, data.byteLength);
  const headerHex = Array.from(bytes.slice(0, headerBytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join(" ");

  // Parse Mibl footer from end of file
  const miblFooter = parseMiblFooter(data);
  
  let textureWidth: number;
  let textureHeight: number;
  let imageFormat: number;
  let textureDataSize: number;
  let textureDataOffset: number;

  if (miblFooter) {
    textureWidth = miblFooter.width;
    textureHeight = miblFooter.height;
    imageFormat = miblFooter.imageFormat;
    
    const bpp = getBpp(imageFormat);
    const bc = isBlockCompressed(imageFormat);
    textureDataSize = swizzledSize(textureWidth, textureHeight, bpp, bc);
    
    // Try reading texture offset directly from LAFT header (byte 36) and texture size (byte 40)
    const view = new DataView(data);
    let laftTextureOffset = 0;
    let laftTextureSize = 0;
    if (data.byteLength >= 44) {
      laftTextureOffset = view.getUint32(36, true);
      laftTextureSize = view.getUint32(40, true);
    }
    
    if (laftTextureOffset > 0 && laftTextureOffset < data.byteLength && laftTextureSize > 0) {
      // Use values from LAFT header directly
      textureDataOffset = laftTextureOffset;
      textureDataSize = laftTextureSize;
    } else {
      // Fallback: compute from Mibl footer
      const alignedSize = Math.ceil(textureDataSize / 4096) * 4096;
      const padding = alignedSize - textureDataSize;
      const miblTotalSize = padding >= MIBL_FOOTER_SIZE ? alignedSize : alignedSize + 4096;
      textureDataOffset = data.byteLength - miblTotalSize;
      if (textureDataOffset < 0) {
        textureDataOffset = data.byteLength - miblFooter.imageSize;
      }
      if (textureDataOffset % 4096 !== 0 && textureDataOffset > 0) {
        textureDataOffset = Math.floor(textureDataOffset / 4096) * 4096;
      }
    }
    
    console.log('[WIFNT Diagnostic] Mibl Footer:', {
      imageFormat,
      formatName: getFormatName(imageFormat),
      width: textureWidth,
      height: textureHeight,
      imageSize: miblFooter.imageSize,
      laftTextureOffset,
      laftTextureSize,
      computedTextureDataOffset: textureDataOffset,
      computedTextureDataSize: textureDataSize,
      fileSize: data.byteLength,
    });
  } else {
    // Fallback: hardcoded values for XC3
    textureWidth = 2800;
    textureHeight = 171;
    imageFormat = FORMAT_BC1;
    const blocksX = divRoundUp(textureWidth, 4);
    const blocksY = divRoundUp(textureHeight, 4);
    textureDataSize = blocksX * blocksY * 8;
    textureDataOffset = data.byteLength - textureDataSize;
  }

  // Calculate grid from FontSettings in header if available
  // FontSettings is at an offset stored in the LAFT header
  let cellWidth = 56, cellHeight = 57, gridCols = 50, gridRows = 3;
  
  // Try to read FontSettings from the header
  // The settings offset is stored in the LAFT header
  const settingsResult = readFontSettings(data);
  if (settingsResult) {
    textureWidth = settingsResult.textureWidth || textureWidth;
    textureHeight = settingsResult.textureHeight || textureHeight;
    cellWidth = (settingsResult.glyphAreaWidth || 0) + 1 || cellWidth;
    cellHeight = (settingsResult.glyphAreaHeight || 0) + 1 || cellHeight;
    gridCols = settingsResult.glyphsPerRow || gridCols;
    gridRows = settingsResult.numRows || gridRows;
  }

  const glyphCount = gridCols * gridRows;
  const headerSize = Math.max(0, textureDataOffset);

  return {
    fileSize: data.byteLength,
    magic,
    valid,
    textureWidth,
    textureHeight,
    gridCols,
    gridRows,
    cellWidth,
    cellHeight,
    glyphCount,
    headerSize,
    textureDataOffset: Math.max(0, textureDataOffset),
    textureDataSize,
    imageFormat,
    imageFormatName: getFormatName(imageFormat),
    headerHex,
  };
}

/**
 * Try to read FontSettings from the LAFT header.
 * FontSettings offset is stored at byte 44 of the header (after LAFT header fields).
 * 
 * LAFT header layout:
 * 0-3: "LAFT"
 * 4-7: version (u32)
 * 8-11: padding
 * 12-15: font_info offset (u32)
 * 16-19: offsets offset (u32)
 * 20-23: offsets count (u32)
 * 24-27: mappings offset (u32)
 * 28-31: mappings count (u32)
 * 32-35: glyph_class_mask (u32)
 * 36-39: texture offset (u32)
 * 40-43: texture size (u32)
 * 44-47: settings offset (u32)
 * 48-51: global_width_reduction (u32)
 * 52-55: line_height (u32)
 */
function readFontSettings(data: ArrayBuffer): {
  textureWidth: number;
  textureHeight: number;
  glyphAreaWidth: number;
  glyphAreaHeight: number;
  glyphsPerRow: number;
  numRows: number;
} | null {
  if (data.byteLength < 56) return null;
  try {
    const view = new DataView(data);
    const settingsOffset = view.getUint32(44, true);
    if (settingsOffset + 24 > data.byteLength || settingsOffset === 0) return null;
    
    return {
      textureWidth: view.getUint32(settingsOffset, true),
      textureHeight: view.getUint32(settingsOffset + 4, true),
      glyphAreaWidth: view.getUint32(settingsOffset + 8, true),
      glyphAreaHeight: view.getUint32(settingsOffset + 12, true),
      glyphsPerRow: view.getUint32(settingsOffset + 16, true),
      numRows: view.getUint32(settingsOffset + 20, true),
    };
  } catch {
    return null;
  }
}

/**
 * Tegra X1 Block Linear address calculation.
 * Reference: KillzXGaming/Switch-Toolbox (ported from AboodXD's BNTX Extractor)
 * 
 * In-GOB bit layout (9 bits = 512 bytes per GOB):
 *   [bit 8: x5] [bits 7-6: y2-y1] [bit 5: x4] [bit 4: y0] [bits 3-0: x3-x0]
 */
function getAddrBlockLinear(
  x: number, y: number,
  widthInUnits: number, bpp: number,
  blockHeight: number, gobsX: number
): number {
  const xByte = x * bpp;
  const gobAddress =
    Math.floor(y / (8 * blockHeight)) * 512 * blockHeight * gobsX +
    Math.floor(xByte / 64) * 512 * blockHeight +
    Math.floor((y % (8 * blockHeight)) / 8) * 512;
  
  // Correct in-GOB offset per Tegra X1 TRM
  const xb = xByte;
  const inGobOffset =
    (Math.floor((xb % 64) / 32) * 256) +
    (Math.floor((y % 8) / 2) * 64) +
    (Math.floor((xb % 32) / 16) * 32) +
    ((y % 2) * 16) +
    (xb % 16);
  
  return gobAddress + inGobOffset;
}

/**
 * Deswizzle Tegra X1 block linear data.
 * widthInUnits/heightInUnits: for BC formats, these are in blocks (pixels/4).
 */
function deswizzleBlockLinear(
  swizzledData: Uint8Array,
  widthInUnits: number,
  heightInUnits: number,
  bpp: number
): Uint8Array {
  const byteWidth = widthInUnits * bpp;
  const gobsX = divRoundUp(byteWidth, 64);
  const blockHeight = getBlockHeight(heightInUnits);
  const linearSize = widthInUnits * heightInUnits * bpp;
  const linear = new Uint8Array(linearSize);

  for (let y = 0; y < heightInUnits; y++) {
    for (let x = 0; x < widthInUnits; x++) {
      const linearOffset = (y * widthInUnits + x) * bpp;
      const swizzledOffset = getAddrBlockLinear(x, y, widthInUnits, bpp, blockHeight, gobsX);
      if (swizzledOffset + bpp <= swizzledData.length) {
        for (let b = 0; b < bpp; b++) {
          linear[linearOffset + b] = swizzledData[swizzledOffset + b];
        }
      }
    }
  }
  return linear;
}

/**
 * Reswizzle linear data to Tegra X1 block linear layout.
 */
function swizzleBlockLinear(
  linearData: Uint8Array,
  widthInUnits: number,
  heightInUnits: number,
  bpp: number
): Uint8Array {
  const byteWidth = widthInUnits * bpp;
  const gobsX = divRoundUp(byteWidth, 64);
  const blockHeight = getBlockHeight(heightInUnits);
  const gobsY = divRoundUp(heightInUnits, 8 * blockHeight);
  const swizzledSz = gobsX * gobsY * blockHeight * 512;
  const swizzled = new Uint8Array(swizzledSz);

  for (let y = 0; y < heightInUnits; y++) {
    for (let x = 0; x < widthInUnits; x++) {
      const linearOffset = (y * widthInUnits + x) * bpp;
      const swizzledOffset = getAddrBlockLinear(x, y, widthInUnits, bpp, blockHeight, gobsX);
      if (linearOffset + bpp <= linearData.length && swizzledOffset + bpp <= swizzled.length) {
        for (let b = 0; b < bpp; b++) {
          swizzled[swizzledOffset + b] = linearData[linearOffset + b];
        }
      }
    }
  }
  return swizzled;
}

/**
 * Decode BC1 (DXT1) compressed texture data to RGBA pixels
 */
export function decodeDXT1(
  compressedData: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const output = new Uint8Array(width * height * 4);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockIndex = (by * blocksX + bx) * 8;
      if (blockIndex + 8 > compressedData.length) break;

      const c0 = compressedData[blockIndex] | (compressedData[blockIndex + 1] << 8);
      const c1 = compressedData[blockIndex + 2] | (compressedData[blockIndex + 3] << 8);

      const colors: [number, number, number, number][] = [
        rgb565ToRGBA(c0),
        rgb565ToRGBA(c1),
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ];

      if (c0 > c1) {
        colors[2] = [
          Math.round((2 * colors[0][0] + colors[1][0]) / 3),
          Math.round((2 * colors[0][1] + colors[1][1]) / 3),
          Math.round((2 * colors[0][2] + colors[1][2]) / 3),
          255,
        ];
        colors[3] = [
          Math.round((colors[0][0] + 2 * colors[1][0]) / 3),
          Math.round((colors[0][1] + 2 * colors[1][1]) / 3),
          Math.round((colors[0][2] + 2 * colors[1][2]) / 3),
          255,
        ];
      } else {
        colors[2] = [
          Math.round((colors[0][0] + colors[1][0]) / 2),
          Math.round((colors[0][1] + colors[1][1]) / 2),
          Math.round((colors[0][2] + colors[1][2]) / 2),
          255,
        ];
        colors[3] = [0, 0, 0, 0];
      }

      const indices = compressedData[blockIndex + 4]
        | (compressedData[blockIndex + 5] << 8)
        | (compressedData[blockIndex + 6] << 16)
        | (compressedData[blockIndex + 7] << 24);

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;

          const bitIndex = (py * 4 + px) * 2;
          const colorIndex = (indices >>> bitIndex) & 0x3;
          const color = colors[colorIndex];

          const outIndex = (y * width + x) * 4;
          output[outIndex] = color[0];
          output[outIndex + 1] = color[1];
          output[outIndex + 2] = color[2];
          output[outIndex + 3] = color[3];
        }
      }
    }
  }

  return output;
}

function rgb565ToRGBA(c: number): [number, number, number, number] {
  const r = ((c >> 11) & 0x1F) * 255 / 31;
  const g = ((c >> 5) & 0x3F) * 255 / 63;
  const b = (c & 0x1F) * 255 / 31;
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

/**
 * Decode BC4 compressed texture data to RGBA pixels (single channel → grayscale + alpha)
 */
export function decodeBC4(
  compressedData: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const output = new Uint8Array(width * height * 4);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockIndex = (by * blocksX + bx) * 8;
      if (blockIndex + 8 > compressedData.length) break;

      const alpha0 = compressedData[blockIndex];
      const alpha1 = compressedData[blockIndex + 1];

      // Build palette
      const palette: number[] = [alpha0, alpha1, 0, 0, 0, 0, 0, 0];
      if (alpha0 > alpha1) {
        for (let i = 1; i <= 6; i++) {
          palette[i + 1] = Math.round(((7 - i) * alpha0 + i * alpha1) / 7);
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          palette[i + 1] = Math.round(((5 - i) * alpha0 + i * alpha1) / 5);
        }
        palette[6] = 0;
        palette[7] = 255;
      }

      // Read 48 bits of 3-bit indices (6 bytes)
      const bits = [
        compressedData[blockIndex + 2],
        compressedData[blockIndex + 3],
        compressedData[blockIndex + 4],
        compressedData[blockIndex + 5],
        compressedData[blockIndex + 6],
        compressedData[blockIndex + 7],
      ];

      // Convert to a 48-bit value for easier indexing
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;

          const pixelIndex = py * 4 + px;
          const bitOffset = pixelIndex * 3;
          const byteIdx = Math.floor(bitOffset / 8);
          const bitIdx = bitOffset % 8;
          
          let idx: number;
          if (bitIdx <= 5) {
            idx = (bits[byteIdx] >> bitIdx) & 0x7;
          } else {
            idx = ((bits[byteIdx] >> bitIdx) | (bits[byteIdx + 1] << (8 - bitIdx))) & 0x7;
          }

          const val = palette[idx];
          const outIndex = (y * width + x) * 4;
          // BC4 is single-channel: use as white with alpha
          output[outIndex] = 255;
          output[outIndex + 1] = 255;
          output[outIndex + 2] = 255;
          output[outIndex + 3] = val;
        }
      }
    }
  }

  return output;
}

/**
 * Encode RGBA pixels to BC4 compressed data (uses alpha channel)
 */
export function encodeBC4(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const output = new Uint8Array(blocksX * blocksY * 8);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Extract alpha values for 4x4 block
      const alphas: number[] = [];
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < width && y < height) {
            const i = (y * width + x) * 4;
            alphas.push(pixels[i + 3]); // alpha channel
          } else {
            alphas.push(0);
          }
        }
      }

      // Find min/max
      let minA = 255, maxA = 0;
      for (const a of alphas) {
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }

      const alpha0 = maxA;
      const alpha1 = minA;

      // Build palette (8 values mode)
      const palette: number[] = [alpha0, alpha1, 0, 0, 0, 0, 0, 0];
      if (alpha0 > alpha1) {
        for (let i = 1; i <= 6; i++) {
          palette[i + 1] = Math.round(((7 - i) * alpha0 + i * alpha1) / 7);
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          palette[i + 1] = Math.round(((5 - i) * alpha0 + i * alpha1) / 5);
        }
        palette[6] = 0;
        palette[7] = 255;
      }

      // Find best index for each pixel
      const indices: number[] = [];
      for (const a of alphas) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let ci = 0; ci < 8; ci++) {
          const dist = Math.abs(a - palette[ci]);
          if (dist < bestDist) { bestDist = dist; bestIdx = ci; }
        }
        indices.push(bestIdx);
      }

      // Pack into 48 bits (6 bytes)
      const blockOffset = (by * blocksX + bx) * 8;
      output[blockOffset] = alpha0;
      output[blockOffset + 1] = alpha1;

      // Pack 16 × 3-bit indices into 6 bytes
      const bitBuffer = new Uint8Array(6);
      for (let i = 0; i < 16; i++) {
        const bitOffset = i * 3;
        const byteIdx = Math.floor(bitOffset / 8);
        const bitIdx = bitOffset % 8;
        bitBuffer[byteIdx] |= (indices[i] & 0x7) << bitIdx;
        if (bitIdx > 5) {
          bitBuffer[byteIdx + 1] |= (indices[i] & 0x7) >> (8 - bitIdx);
        }
      }
      output[blockOffset + 2] = bitBuffer[0];
      output[blockOffset + 3] = bitBuffer[1];
      output[blockOffset + 4] = bitBuffer[2];
      output[blockOffset + 5] = bitBuffer[3];
      output[blockOffset + 6] = bitBuffer[4];
      output[blockOffset + 7] = bitBuffer[5];
    }
  }
  return output;
}

/**
 * Extract the texture data from a WIFNT file and decode it to an ImageData-compatible RGBA array
 */
export function decodeWifntTexture(
  fileData: ArrayBuffer,
  info: WifntInfo
): Uint8ClampedArray | null {
  try {
    const dataLen = Math.min(info.textureDataSize, fileData.byteLength - info.textureDataOffset);
    if (dataLen <= 0) return null;
    
    const swizzledData = new Uint8Array(fileData, info.textureDataOffset, dataLen);
    
    const bc = isBlockCompressed(info.imageFormat);
    const bpp = getBpp(info.imageFormat);
    
    let linearData: Uint8Array;
    if (bc) {
      const blocksX = divRoundUp(info.textureWidth, 4);
      const blocksY = divRoundUp(info.textureHeight, 4);
      linearData = deswizzleBlockLinear(swizzledData, blocksX, blocksY, bpp);
    } else {
      linearData = deswizzleBlockLinear(swizzledData, info.textureWidth, info.textureHeight, bpp);
    }
    
    let rgba: Uint8Array;
    if (info.imageFormat === FORMAT_BC4) {
      rgba = decodeBC4(linearData, info.textureWidth, info.textureHeight);
    } else {
      // Default to BC1
      rgba = decodeDXT1(linearData, info.textureWidth, info.textureHeight);
    }
    
    return new Uint8ClampedArray(rgba.buffer);
  } catch (e) {
    console.error("decodeWifntTexture error:", e);
    return null;
  }
}

/**
 * Render the full texture atlas to a canvas and return it
 */
export function renderAtlasToCanvas(
  fileData: ArrayBuffer,
  info: WifntInfo
): HTMLCanvasElement | null {
  const pixels = decodeWifntTexture(fileData, info);
  if (!pixels) return null;

  const canvas = document.createElement("canvas");
  canvas.width = info.textureWidth;
  canvas.height = info.textureHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const imageData = new ImageData(new Uint8ClampedArray(pixels), info.textureWidth, info.textureHeight);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Extract a single glyph from the atlas as a canvas
 */
export function extractGlyph(
  atlasCanvas: HTMLCanvasElement,
  info: WifntInfo,
  index: number
): HTMLCanvasElement | null {
  if (index < 0 || index >= info.glyphCount) return null;

  const col = index % info.gridCols;
  const row = Math.floor(index / info.gridCols);
  const x = col * info.cellWidth;
  const y = row * info.cellHeight;

  const canvas = document.createElement("canvas");
  canvas.width = info.cellWidth;
  canvas.height = info.cellHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(
    atlasCanvas,
    x, y, info.cellWidth, info.cellHeight,
    0, 0, info.cellWidth, info.cellHeight
  );
  return canvas;
}

/**
 * Encode RGBA pixels to BC1 (DXT1) compressed data
 */
export function encodeDXT1(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const output = new Uint8Array(blocksX * blocksY * 8);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockColors: [number, number, number, number][] = [];
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < width && y < height) {
            const i = (y * width + x) * 4;
            blockColors.push([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]);
          } else {
            blockColors.push([0, 0, 0, 0]);
          }
        }
      }

      let minR = 255, minG = 255, minB = 255;
      let maxR = 0, maxG = 0, maxB = 0;
      let hasTransparent = false;

      for (const [r, g, b, a] of blockColors) {
        if (a < 128) { hasTransparent = true; continue; }
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (g < minG) minG = g; if (g > maxG) maxG = g;
        if (b < minB) minB = b; if (b > maxB) maxB = b;
      }

      let c0 = rgbaToRGB565(maxR, maxG, maxB);
      let c1 = rgbaToRGB565(minR, minG, minB);

      if (hasTransparent) {
        if (c0 > c1) { const tmp = c0; c0 = c1; c1 = tmp; }
      } else {
        if (c0 < c1) { const tmp = c0; c0 = c1; c1 = tmp; }
        if (c0 === c1 && c0 < 0xFFFF) c0++;
      }

      const colors = [rgb565Decode(c0), rgb565Decode(c1), [0, 0, 0], [0, 0, 0]] as number[][];
      if (c0 > c1) {
        colors[2] = [Math.round((2 * colors[0][0] + colors[1][0]) / 3), Math.round((2 * colors[0][1] + colors[1][1]) / 3), Math.round((2 * colors[0][2] + colors[1][2]) / 3)];
        colors[3] = [Math.round((colors[0][0] + 2 * colors[1][0]) / 3), Math.round((colors[0][1] + 2 * colors[1][1]) / 3), Math.round((colors[0][2] + 2 * colors[1][2]) / 3)];
      } else {
        colors[2] = [Math.round((colors[0][0] + colors[1][0]) / 2), Math.round((colors[0][1] + colors[1][1]) / 2), Math.round((colors[0][2] + colors[1][2]) / 2)];
        colors[3] = [0, 0, 0];
      }

      let indices = 0;
      for (let i = 0; i < 16; i++) {
        const [r, g, b, a] = blockColors[i];
        let best = 0;
        if (hasTransparent && a < 128) {
          best = 3;
        } else {
          let bestDist = Infinity;
          const limit = hasTransparent ? 3 : 4;
          for (let ci = 0; ci < limit; ci++) {
            const dr = r - colors[ci][0], dg = g - colors[ci][1], db = b - colors[ci][2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) { bestDist = dist; best = ci; }
          }
        }
        indices |= (best << (i * 2));
      }

      const blockOffset = (by * blocksX + bx) * 8;
      output[blockOffset] = c0 & 0xFF;
      output[blockOffset + 1] = (c0 >> 8) & 0xFF;
      output[blockOffset + 2] = c1 & 0xFF;
      output[blockOffset + 3] = (c1 >> 8) & 0xFF;
      output[blockOffset + 4] = indices & 0xFF;
      output[blockOffset + 5] = (indices >> 8) & 0xFF;
      output[blockOffset + 6] = (indices >> 16) & 0xFF;
      output[blockOffset + 7] = (indices >> 24) & 0xFF;
    }
  }
  return output;
}

function rgbaToRGB565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function rgb565Decode(c: number): number[] {
  return [
    Math.round(((c >> 11) & 0x1F) * 255 / 31),
    Math.round(((c >> 5) & 0x3F) * 255 / 63),
    Math.round((c & 0x1F) * 255 / 31),
  ];
}

/**
 * Rebuild a WIFNT file by replacing the texture data with new RGBA pixels.
 * Encodes to the original format and reswizzles for Switch.
 */
export function rebuildWifnt(
  originalFile: ArrayBuffer,
  info: WifntInfo,
  newPixels: Uint8Array | Uint8ClampedArray
): ArrayBuffer {
  // Encode RGBA to the appropriate BC format
  let linearBC: Uint8Array;
  if (info.imageFormat === FORMAT_BC4) {
    linearBC = encodeBC4(newPixels, info.textureWidth, info.textureHeight);
  } else {
    linearBC = encodeDXT1(newPixels, info.textureWidth, info.textureHeight);
  }
  
  // Reswizzle to Tegra X1 block linear layout
  const bc = isBlockCompressed(info.imageFormat);
  const bpp = getBpp(info.imageFormat);
  let swizzled: Uint8Array;
  if (bc) {
    const blocksX = divRoundUp(info.textureWidth, 4);
    const blocksY = divRoundUp(info.textureHeight, 4);
    swizzled = swizzleBlockLinear(linearBC, blocksX, blocksY, bpp);
  } else {
    swizzled = swizzleBlockLinear(linearBC, info.textureWidth, info.textureHeight, bpp);
  }
  
  // Reconstruct the file: header + swizzled data + padding + footer
  const header = new Uint8Array(originalFile, 0, info.textureDataOffset);
  
  // Get the original file's tail (everything after texture data including footer)
  const originalSwizzledEnd = info.textureDataOffset + info.textureDataSize;
  const tailStart = originalSwizzledEnd;
  const tailSize = originalFile.byteLength - tailStart;
  const tail = tailSize > 0 ? new Uint8Array(originalFile, tailStart, tailSize) : new Uint8Array(0);
  
  const result = new Uint8Array(header.length + swizzled.length + tail.length);
  result.set(header);
  result.set(swizzled, header.length);
  if (tail.length > 0) {
    result.set(tail, header.length + swizzled.length);
  }
  
  // Update the Mibl footer's image_size field if present
  if (result.length >= MIBL_FOOTER_SIZE) {
    const footerOff = result.length - MIBL_FOOTER_SIZE;
    const m = String.fromCharCode(result[footerOff + 36], result[footerOff + 37], result[footerOff + 38], result[footerOff + 39]);
    if (m === "LBIM") {
      const alignedSize = Math.ceil(swizzled.length / 4096) * 4096;
      const view = new DataView(result.buffer);
      view.setUint32(footerOff, alignedSize, true);
    }
  }
  
  return result.buffer;
}
