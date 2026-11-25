/**
 * Embedded core tag vocabulary and its popularity.
 *
 * A small, generated slice of the full index so tag suggestions work on the first visit without
 * waiting for the repository asset. The counts are the ones the slice was selected by, quantized
 * against the full snapshot's maximum, so first-run ranking matches the full index's scale. Both
 * payloads are decoded on first use and kept in memory; the full index replaces them once
 * downloaded.
 */

import { bytesFromBase64 } from "./base64";
import { CORE_COUNTS_BASE64, CORE_VOCABULARY_BASE64 } from "./core-vocabulary";
import { decodeTagVocabulary } from "./index-codec";
import type { TagCounts } from "./tag-counts-codec";
import { decodeTagCountsFromBytes } from "./tag-counts-codec";

export interface CoreTagData {
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** The counts for the selected tags, or null when the generated payload is empty. */
  readonly counts: TagCounts | null;
}

let data: CoreTagData | null | undefined;

/** The embedded namespaces, keys and popularity, or null when a payload is corrupt. */
export function coreTagData(): CoreTagData | null {
  if (data !== undefined) {
    return data;
  }
  const bytes = bytesFromBase64(CORE_VOCABULARY_BASE64);
  const groups = bytes === null ? null : decodeTagVocabulary(bytes);
  if (groups === null) {
    data = null;
    return null;
  }
  const countBytes = bytesFromBase64(CORE_COUNTS_BASE64);
  const counts = countBytes === null ? null : decodeTagCountsFromBytes(countBytes);
  data = { groups, counts };
  return data;
}
