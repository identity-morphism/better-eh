import { bytesFromBase64 } from "./base64";
import { hasCodecHeader } from "./codec-header";
import { normaliseTagKey } from "./model";

/**
 * Compact codec for the vendored tag popularity snapshot.
 *
 * Layout (little-endian):
 *
 * | offset | size  | meaning                                       |
 * | ------ | ----- | --------------------------------------------- |
 * | 0      | 4     | magic `BETC`                                  |
 * | 4      | 1     | format version                                |
 * | 5      | 4     | largest gallery count (`uint32`)              |
 * | 9      | 2     | entry count (`uint16`)                        |
 * | 11     | 6 × N | 40-bit tag hash + 1-byte quantized popularity |
 *
 * Tag names are not stored. The hash gives a stable identity for a folded tag key, and the
 * quantized popularity keeps the ranking signal without the key strings. A 40-bit hash makes
 * collisions vanishingly unlikely for the few thousand tags worth ranking.
 *
 * The same bytes are fetched raw as the remote asset and stored base64-encoded as the counts store
 * record payload.
 */

const MAGIC = [0x42, 0x45, 0x54, 0x43] as const;
const VERSION = 1;
export const HEADER_BYTES = 11;
export const ENTRY_BYTES = 6;
const QUANT_MAX = 255;

export interface TagCounts {
  /** 40-bit tag hash to approximate gallery count. */
  readonly counts: ReadonlyMap<number, number>;
  /** Largest gallery count in the snapshot, used to normalize the ranking prior. */
  readonly max: number;
}

function hash32(key: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Stable 40-bit identity for a tag key.
 *
 * The key is cleaned and folded here, so raw and already-normalized spellings hash alike. Two
 * FNV-1a passes with different seeds make a collision between the ~2–3k vendored tags negligible
 * while keeping the id inside the exact-integer range.
 */
export function tagKeyId(key: string): number {
  const normalized = normaliseTagKey(key);
  const high = hash32(normalized, 0x811c9dc5);
  const low = hash32(normalized, 0x9e3779b9) & 0xff;
  return high * 0x100 + low;
}

/** Quantize a gallery count to one byte on the `log1p` scale. */
export function quantiseCount(count: number, max: number): number {
  if (count <= 0 || max <= 0) {
    return 0;
  }
  const value = Math.round((QUANT_MAX * Math.log1p(count)) / Math.log1p(max));
  return Math.min(QUANT_MAX, Math.max(1, value));
}

/** Reconstruct an approximate gallery count from its quantized byte. */
export function dequantiseCount(quantized: number, max: number): number {
  if (quantized <= 0 || max <= 0) {
    return 0;
  }
  return Math.round(Math.expm1((quantized / QUANT_MAX) * Math.log1p(max)));
}

/**
 * Encode tag keys and counts into the compact binary payload.
 *
 * Keys are normalized by {@link tagKeyId}, so callers may pass raw or folded spellings. Duplicate
 * hashes keep the larger count; with a 40-bit id this is a safety net rather than an expected
 * path.
 */
export function encodeTagCountsBytes(counts: ReadonlyMap<string, number>): Uint8Array {
  const byId = new Map<number, number>();
  let max = 0;

  for (const [key, count] of counts) {
    if (count <= 0) {
      continue;
    }
    if (count > max) {
      max = count;
    }
    const id = tagKeyId(key);
    const previous = byId.get(id) ?? 0;
    if (count > previous) {
      byId.set(id, count);
    }
  }

  if (byId.size === 0) {
    throw new Error("No tag counts to encode");
  }
  if (byId.size > 0xffff) {
    throw new Error("Too many tag counts for the uint16 header");
  }
  if (max > 0xffffffff) {
    throw new Error("Tag count exceeds the uint32 header");
  }

  const items = [...byId.entries()]
    .map(([id, count]) => [id, quantiseCount(count, max)] as const)
    .sort((a, b) => a[0] - b[0]);

  const bytes = new Uint8Array(HEADER_BYTES + items.length * ENTRY_BYTES);
  for (const [index, value] of MAGIC.entries()) {
    bytes[index] = value;
  }
  bytes[4] = VERSION;
  const view = new DataView(bytes.buffer);
  view.setUint32(5, max, true);
  view.setUint16(9, items.length, true);

  let offset = HEADER_BYTES;
  for (const [id, quantized] of items) {
    bytes[offset] = id & 0xff;
    bytes[offset + 1] = (id >>> 8) & 0xff;
    bytes[offset + 2] = (id >>> 16) & 0xff;
    bytes[offset + 3] = (id >>> 24) & 0xff;
    bytes[offset + 4] = Math.floor(id / 0x100000000) & 0xff;
    bytes[offset + 5] = quantized;
    offset += ENTRY_BYTES;
  }

  return bytes;
}

/** Decode a raw binary payload; returns `null` for corrupt or unexpected data. */
export function decodeTagCountsFromBytes(bytes: Uint8Array): TagCounts | null {
  if (!hasCodecHeader(bytes, MAGIC, VERSION, HEADER_BYTES)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const max = view.getUint32(5, true);
  const entryCount = view.getUint16(9, true);
  if (max <= 0 || bytes.length !== HEADER_BYTES + entryCount * ENTRY_BYTES) {
    return null;
  }

  const counts = new Map<number, number>();
  for (let index = 0; index < entryCount; index++) {
    const offset = HEADER_BYTES + index * ENTRY_BYTES;
    const id =
      (bytes[offset] ?? 0) +
      (bytes[offset + 1] ?? 0) * 0x100 +
      (bytes[offset + 2] ?? 0) * 0x10000 +
      (bytes[offset + 3] ?? 0) * 0x1000000 +
      (bytes[offset + 4] ?? 0) * 0x100000000;
    const quantized = bytes[offset + 5] ?? 0;
    counts.set(id, dequantiseCount(quantized, max));
  }
  return { counts, max };
}

/** Decode the base64 payload kept in the counts store record. */
export function decodeTagCounts(base64: string): TagCounts | null {
  const bytes = bytesFromBase64(base64);
  return bytes ? decodeTagCountsFromBytes(bytes) : null;
}
