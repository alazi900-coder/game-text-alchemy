/**
 * DXT5 (BC3) texture compression codec.
 * Ported from the LM2HD standalone Arabic tool.
 */

export function decodeDXT5Block(src: Uint8Array, srcOff: number): Uint8Array {
  const alpha0 = src[srcOff], alpha1 = src[srcOff + 1];
  let alphaBits = 0n;
  for (let i = 7; i >= 2; i--) alphaBits = (alphaBits << 8n) | BigInt(src[srcOff + i]);

  const alphaTable = [alpha0, alpha1];
  if (alpha0 > alpha1) {
    for (let i = 1; i <= 6; i++) alphaTable.push(Math.round(((7 - i) * alpha0 + i * alpha1) / 7));
  } else {
    for (let i = 1; i <= 4; i++) alphaTable.push(Math.round(((5 - i) * alpha0 + i * alpha1) / 5));
    alphaTable.push(0, 255);
  }

  const alphas = new Uint8Array(16);
  for (let i = 0; i < 16; i++) alphas[i] = alphaTable[Number((alphaBits >> BigInt(3 * i)) & 7n)];

  const c0 = src[srcOff + 8] | (src[srcOff + 9] << 8);
  const c1 = src[srcOff + 10] | (src[srcOff + 11] << 8);
  const bits = src[srcOff + 12] | (src[srcOff + 13] << 8) | (src[srcOff + 14] << 16) | (src[srcOff + 15] << 24);

  function rgb565(c: number): number[] {
    return [((c >> 11) & 0x1F) * 255 / 31 | 0, ((c >> 5) & 0x3F) * 255 / 63 | 0, (c & 0x1F) * 255 / 31 | 0];
  }
  const colors = [rgb565(c0), rgb565(c1)];
  colors.push(colors[0].map((v, i) => (2 * v + colors[1][i]) / 3 | 0));
  colors.push(colors[0].map((v, i) => (v + 2 * colors[1][i]) / 3 | 0));

  const pixels = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const ci = (bits >>> (2 * i)) & 3;
    const pi = i * 4;
    pixels[pi] = colors[ci][0];
    pixels[pi + 1] = colors[ci][1];
    pixels[pi + 2] = colors[ci][2];
    pixels[pi + 3] = alphas[i];
  }
  return pixels;
}

export function decodeDXT5(src: Uint8Array, width: number, height: number): Uint8Array {
  const dst = new Uint8Array(width * height * 4);
  let blockIdx = 0;
  for (let by = 0; by < height / 4; by++) {
    for (let bx = 0; bx < width / 4; bx++) {
      const pixels = decodeDXT5Block(src, blockIdx * 16);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const sx = bx * 4 + px, sy = by * 4 + py;
          const di = (sy * width + sx) * 4;
          const si = (py * 4 + px) * 4;
          dst[di] = pixels[si]; dst[di + 1] = pixels[si + 1];
          dst[di + 2] = pixels[si + 2]; dst[di + 3] = pixels[si + 3];
        }
      }
      blockIdx++;
    }
  }
  return dst;
}

export function encodeDXT5Block(pixels: Uint8Array, dst: Uint8Array, dstOff: number): void {
  // Alpha encoding
  let minA = 255, maxA = 0;
  for (let i = 0; i < 16; i++) {
    const a = pixels[i * 4 + 3];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }

  dst[dstOff] = maxA; dst[dstOff + 1] = minA;

  const alphaTable = [maxA, minA];
  if (maxA > minA) {
    for (let i = 1; i <= 6; i++) alphaTable.push(Math.round(((7 - i) * maxA + i * minA) / 7));
  } else {
    for (let i = 1; i <= 4; i++) alphaTable.push(Math.round(((5 - i) * maxA + i * minA) / 5));
    alphaTable.push(0, 255);
  }

  let alphaBits = 0n;
  for (let i = 15; i >= 0; i--) {
    const a = pixels[i * 4 + 3];
    let bestIdx = 0, bestDist = 9999;
    for (let j = 0; j < 8; j++) {
      const d = Math.abs(a - alphaTable[j]);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    alphaBits = (alphaBits << 3n) | BigInt(bestIdx);
  }
  for (let i = 0; i < 6; i++) {
    dst[dstOff + 2 + i] = Number((alphaBits >> BigInt(8 * i)) & 0xFFn);
  }

  // Color encoding
  let minR = 255, minG = 255, minB = 255, maxR = 0, maxG = 0, maxB = 0;
  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    if (r < minR) minR = r; if (g < minG) minG = g; if (b < minB) minB = b;
    if (r > maxR) maxR = r; if (g > maxG) maxG = g; if (b > maxB) maxB = b;
  }

  function toRGB565(r: number, g: number, b: number): number {
    return ((r * 31 / 255 | 0) << 11) | ((g * 63 / 255 | 0) << 5) | (b * 31 / 255 | 0);
  }
  const c0 = toRGB565(maxR, maxG, maxB);
  const c1 = toRGB565(minR, minG, minB);

  dst[dstOff + 8] = c0 & 0xFF; dst[dstOff + 9] = (c0 >> 8) & 0xFF;
  dst[dstOff + 10] = c1 & 0xFF; dst[dstOff + 11] = (c1 >> 8) & 0xFF;

  function from565(c: number): number[] {
    return [((c >> 11) & 0x1F) * 255 / 31 | 0, ((c >> 5) & 0x3F) * 255 / 63 | 0, (c & 0x1F) * 255 / 31 | 0];
  }
  const colors = [from565(c0), from565(c1)];
  colors.push(colors[0].map((v, i) => (2 * v + colors[1][i]) / 3 | 0));
  colors.push(colors[0].map((v, i) => (v + 2 * colors[1][i]) / 3 | 0));

  let colorBits = 0;
  for (let i = 15; i >= 0; i--) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    let bestIdx = 0, bestDist = 999999;
    for (let j = 0; j < 4; j++) {
      const d = (r - colors[j][0]) ** 2 + (g - colors[j][1]) ** 2 + (b - colors[j][2]) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    colorBits = (colorBits << 2) | bestIdx;
  }
  dst[dstOff + 12] = colorBits & 0xFF; dst[dstOff + 13] = (colorBits >> 8) & 0xFF;
  dst[dstOff + 14] = (colorBits >> 16) & 0xFF; dst[dstOff + 15] = (colorBits >> 24) & 0xFF;
}

export function encodeDXT5(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const blocks = new Uint8Array((width / 4) * (height / 4) * 16);
  let blockIdx = 0;
  for (let by = 0; by < height / 4; by++) {
    for (let bx = 0; bx < width / 4; bx++) {
      const pixels = new Uint8Array(64);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const sx = bx * 4 + px, sy = by * 4 + py;
          const si = (sy * width + sx) * 4;
          const di = (py * 4 + px) * 4;
          pixels[di] = rgba[si]; pixels[di + 1] = rgba[si + 1];
          pixels[di + 2] = rgba[si + 2]; pixels[di + 3] = rgba[si + 3];
        }
      }
      encodeDXT5Block(pixels, blocks, blockIdx * 16);
      blockIdx++;
    }
  }
  return blocks;
}

/** DDS header size in bytes */
export const DDS_HEADER_SIZE = 128;

/**
 * Build a valid DDS header for a DXT5 (BC3) texture.
 * Returns a 128-byte Uint8Array ready to be prepended to DXT5 block data.
 */
export function buildDDSHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);

  // Magic: "DDS "
  header[0] = 0x44; header[1] = 0x44; header[2] = 0x53; header[3] = 0x20;

  // Header size (always 124)
  view.setUint32(4, 124, true);

  // Flags: CAPS | HEIGHT | WIDTH | PIXELFORMAT | MIPMAPCOUNT | LINEARSIZE
  view.setUint32(8, 0x000A1007, true);

  // Height
  view.setUint32(12, height, true);
  // Width
  view.setUint32(16, width, true);

  // Pitch or linear size (DXT5: width * height for mip0)
  const linearSize = Math.max(1, Math.floor((width + 3) / 4)) * Math.max(1, Math.floor((height + 3) / 4)) * 16;
  view.setUint32(20, linearSize, true);

  // Depth
  view.setUint32(24, 0, true);

  // Mipmap count (1 = no mipmaps)
  view.setUint32(28, 1, true);

  // Reserved (11 DWORDs at offset 32-75)
  // Already zero

  // Pixel format struct (32 bytes starting at offset 76)
  // PF size
  view.setUint32(76, 32, true);
  // PF flags: DDPF_FOURCC
  view.setUint32(80, 0x4, true);
  // FourCC: "DXT5"
  header[84] = 0x44; header[85] = 0x58; header[86] = 0x54; header[87] = 0x35;

  // Caps
  view.setUint32(108, 0x1000, true); // DDSCAPS_TEXTURE

  return header;
}

/**
 * Build a DDS header with mipmaps for NLG font archives.
 * Original LM2HD textures use 9 mipmaps (1024→4).
 */
export function buildDDSHeaderWithMipmaps(width: number, height: number, mipCount: number = 9): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header[0] = 0x44; header[1] = 0x44; header[2] = 0x53; header[3] = 0x20;
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x000A1007, true); // flags
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  const linearSize = Math.max(1, Math.floor((width + 3) / 4)) * Math.max(1, Math.floor((height + 3) / 4)) * 16;
  view.setUint32(20, linearSize, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, mipCount, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x4, true);
  header[84] = 0x44; header[85] = 0x58; header[86] = 0x54; header[87] = 0x35;
  // Caps: TEXTURE | COMPLEX | MIPMAP
  view.setUint32(108, 0x401008, true);
  // Caps2
  view.setUint32(112, 0, true);
  return header;
}

/**
 * Generate all mipmap levels for DXT5 from a source RGBA.
 * Returns concatenated DXT5 data for all mip levels.
 */
export function encodeDXT5WithMipmaps(rgba: Uint8Array, width: number, height: number, mipCount: number = 9): Uint8Array {
  const chunks: Uint8Array[] = [];
  let w = width, h = height;
  let currentRGBA = rgba;
  
  for (let m = 0; m < mipCount; m++) {
    const dxt5 = encodeDXT5(currentRGBA, w, h);
    chunks.push(dxt5);
    
    if (m < mipCount - 1) {
      // Downsample 2x
      const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
      const downsampled = new Uint8Array(nw * nh * 4);
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const sx = x * 2, sy = y * 2;
          let r = 0, g = 0, b = 0, a = 0, count = 0;
          for (let dy = 0; dy < 2 && sy + dy < h; dy++) {
            for (let dx = 0; dx < 2 && sx + dx < w; dx++) {
              const si = ((sy + dy) * w + (sx + dx)) * 4;
              r += currentRGBA[si]; g += currentRGBA[si + 1];
              b += currentRGBA[si + 2]; a += currentRGBA[si + 3];
              count++;
            }
          }
          const di = (y * nw + x) * 4;
          downsampled[di] = (r / count) | 0;
          downsampled[di + 1] = (g / count) | 0;
          downsampled[di + 2] = (b / count) | 0;
          downsampled[di + 3] = (a / count) | 0;
        }
      }
      currentRGBA = downsampled;
      w = nw; h = nh;
    }
  }
  
  const totalSize = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Default texture size for LM2HD font atlases */
export const TEX_SIZE = 1024;

/** DXT5 mip0 data size for a 1024x1024 texture */
export const DXT5_MIP0_SIZE = TEX_SIZE * TEX_SIZE; // 1048576

/** Full DDS size with 9 mipmaps for 1024x1024 DXT5 + header + alignment */
export const DDS_FULL_SIZE_WITH_MIPS = 1398272; // matches original LM2HD

/**
 * Scan a binary buffer for DDS magic ('DDS ') positions.
 */
export function findDDSPositions(data: Uint8Array): number[] {
  const positions: number[] = [];
  for (let i = 0; i < data.length - 4; i += 4) {
    if (data[i] === 0x44 && data[i + 1] === 0x44 && data[i + 2] === 0x53 && data[i + 3] === 0x20) {
      positions.push(i);
    }
  }
  return positions;
}
