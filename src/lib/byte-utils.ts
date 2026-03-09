/**
 * Calculate the byte length of a string in UTF-16LE encoding.
 * This is equivalent to `new Blob([text], { type: 'text/plain;charset=utf-16le' }).size`
 * but much faster as it avoids creating a Blob object on every call.
 */
export function utf16leByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Surrogate pairs (characters outside BMP like emoji) use 4 bytes
    if (code >= 0xD800 && code <= 0xDBFF) {
      bytes += 4;
      i++; // Skip the low surrogate
    } else {
      bytes += 2;
    }
  }
  return bytes;
}
