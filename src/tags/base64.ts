/** Byte-per-character Base64, the storage form of the cached tag-counts payload. */

/** Base64 where every character maps to one byte; safe for userscript storage. */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decode byte-per-character base64 produced by {@link base64FromBytes}. */
export function bytesFromBase64(base64: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
