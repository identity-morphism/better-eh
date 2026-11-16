/**
 * Compact vocabulary payload for the tag index.
 *
 * The upstream EhTagTranslation JSON is about 7 MB because every key carries translations and
 * metadata. Suggestions only need namespace ids and tag keys, so the repository asset stores those
 * sorted and front-coded: each key repeats only the suffix that differs from its predecessor.
 *
 * Layout (little-endian):
 *
 *     0   4   "EHTI"
 *     4   1   format version
 *     5   2   namespace count
 *     then per namespace:
 *           1   id byte length
 *           n   id (UTF-8)
 *           4   key count
 *           ... per key: 1 prefix length (UTF-16 code units), varint suffix byte length, suffix bytes
 */

const MAGIC = [0x45, 0x48, 0x54, 0x49] as const;
const FORMAT_VERSION = 1;
const HEADER_BYTES = 7;
const MAX_NAMESPACES = 128;
const MAX_KEYS_PER_NAMESPACE = 200_000;
const MAX_KEY_BYTES = 4096;

function writeVarint(value: number, out: number[]): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  out.push(remaining);
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let position = offset;
  while (position < bytes.length && shift <= 21) {
    const byte = bytes[position];
    position++;
    if (byte === undefined) {
      return null;
    }
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, next: position };
    }
    shift += 7;
  }
  return null;
}

/** Encode namespace → sorted keys into the repository asset format. */
export function encodeTagVocabulary(groups: ReadonlyMap<string, readonly string[]>): Uint8Array {
  if (groups.size > MAX_NAMESPACES) {
    throw new Error("Too many namespaces");
  }
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[4] = FORMAT_VERSION;
  new DataView(header.buffer).setUint16(5, groups.size, true);
  chunks.push(header);

  for (const [namespace, keys] of groups) {
    const id = encoder.encode(namespace);
    if (id.length === 0 || id.length > 255) {
      throw new Error(`Invalid namespace id: ${namespace}`);
    }
    if (keys.length > MAX_KEYS_PER_NAMESPACE) {
      throw new Error(`Too many keys in namespace: ${namespace}`);
    }

    const groupHeader = new Uint8Array(1 + id.length + 4);
    groupHeader[0] = id.length;
    groupHeader.set(id, 1);
    new DataView(groupHeader.buffer).setUint32(1 + id.length, keys.length, true);
    chunks.push(groupHeader);

    let previous = "";
    for (const key of keys) {
      let prefix = 0;
      while (prefix < previous.length && prefix < key.length && previous[prefix] === key[prefix]) {
        prefix++;
      }
      if (prefix > 255) {
        throw new Error(`Key prefix is too long: ${key}`);
      }
      const suffix = encoder.encode(key.slice(prefix));
      if (suffix.length > MAX_KEY_BYTES) {
        throw new Error(`Key is too long: ${key}`);
      }
      const lengthBytes: number[] = [];
      writeVarint(suffix.length, lengthBytes);
      const entry = new Uint8Array(1 + lengthBytes.length + suffix.length);
      entry[0] = prefix;
      entry.set(lengthBytes, 1);
      entry.set(suffix, 1 + lengthBytes.length);
      chunks.push(entry);
      previous = key;
    }
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** Decode the asset; returns `null` for any corrupt or unsupported payload. */
export function decodeTagVocabulary(bytes: Uint8Array): Map<string, readonly string[]> | null {
  if (bytes.length < HEADER_BYTES) {
    return null;
  }
  for (let index = 0; index < MAGIC.length; index++) {
    if (bytes[index] !== MAGIC[index]) {
      return null;
    }
  }
  if (bytes[4] !== FORMAT_VERSION) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const namespaceCount = view.getUint16(5, true);
  if (namespaceCount === 0 || namespaceCount > MAX_NAMESPACES) {
    return null;
  }

  let offset = HEADER_BYTES;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const groups = new Map<string, readonly string[]>();

  try {
    for (let groupIndex = 0; groupIndex < namespaceCount; groupIndex++) {
      if (offset >= bytes.length) {
        return null;
      }
      const idLength = bytes[offset];
      offset++;
      if (idLength === undefined || idLength === 0 || offset + idLength + 4 > bytes.length) {
        return null;
      }
      const namespace = decoder.decode(bytes.subarray(offset, offset + idLength));
      offset += idLength;
      const keyCount = view.getUint32(offset, true);
      offset += 4;
      if (keyCount > MAX_KEYS_PER_NAMESPACE) {
        return null;
      }

      const keys: string[] = [];
      let previous = "";
      for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
        if (offset >= bytes.length) {
          return null;
        }
        const prefix = bytes[offset];
        offset++;
        const length = readVarint(bytes, offset);
        if (prefix === undefined || length === null) {
          return null;
        }
        offset = length.next;
        if (
          prefix > previous.length ||
          length.value > MAX_KEY_BYTES ||
          offset + length.value > bytes.length
        ) {
          return null;
        }
        const suffix = decoder.decode(bytes.subarray(offset, offset + length.value));
        offset += length.value;
        const key = previous.slice(0, prefix) + suffix;
        if (key === "") {
          return null;
        }
        keys.push(key);
        previous = key;
      }
      groups.set(namespace, keys);
    }
  } catch {
    return null;
  }

  // Trailing bytes mean the payload came from a different schema; do not guess.
  return offset === bytes.length ? groups : null;
}
