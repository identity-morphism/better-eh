/**
 * Embedded core tag vocabulary.
 *
 * A small, generated slice of the full index so tag suggestions work on the first visit without
 * waiting for the repository asset. It is decoded on first use and kept in memory; the full index
 * replaces it once downloaded.
 */

import { bytesFromBase64 } from "./base64";
import { CORE_VOCABULARY_BASE64 } from "./core-vocabulary";
import { decodeTagVocabulary } from "./index-codec";

let groups: Map<string, readonly string[]> | null | undefined;

/** The embedded namespace → sorted keys map, or `null` when the payload is corrupt. */
export function coreVocabularyGroups(): ReadonlyMap<string, readonly string[]> | null {
  if (groups !== undefined) {
    return groups;
  }
  const bytes = bytesFromBase64(CORE_VOCABULARY_BASE64);
  groups = bytes === null ? null : decodeTagVocabulary(bytes);
  return groups;
}
