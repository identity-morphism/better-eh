/** Validation shared by the repository's binary tag assets. */

/**
 * Whether `bytes` starts with `magic`, carries `version` after it, and is at least `headerBytes`
 * long. Every codec writes its version byte immediately after the magic.
 */
export function hasCodecHeader(
  bytes: Uint8Array,
  magic: readonly number[],
  version: number,
  headerBytes: number,
): boolean {
  if (bytes.length < headerBytes) {
    return false;
  }
  for (let index = 0; index < magic.length; index++) {
    if (bytes[index] !== magic[index]) {
      return false;
    }
  }
  return bytes[magic.length] === version;
}
