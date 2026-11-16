/**
 * Turn the upstream EhTagTranslation payload into the namespace → sorted keys map the index and the
 * repository asset both use. Pure: the data workflow imports this without a userscript
 * environment.
 */

import { cleanTagKey, tagNamespace } from "./model";

/** Reject malformed payloads instead of building a partial index. */
export function vocabularyGroups(raw: unknown): Map<string, readonly string[]> {
  const rawData = typeof raw === "object" && raw !== null && "data" in raw ? raw.data : null;
  if (!Array.isArray(rawData)) {
    throw new Error("Tag database has an unexpected shape");
  }

  const groups = new Map<string, Set<string>>();
  for (const group of rawData as readonly unknown[]) {
    if (typeof group !== "object" || group === null) {
      continue;
    }
    const namespaceName = "namespace" in group ? group.namespace : null;
    const namespace = typeof namespaceName === "string" ? tagNamespace(namespaceName) : null;
    const tagData = "data" in group ? group.data : null;
    if (!namespace || typeof tagData !== "object" || tagData === null || Array.isArray(tagData)) {
      continue;
    }

    let keys = groups.get(namespace.id);
    if (!keys) {
      keys = new Set<string>();
      groups.set(namespace.id, keys);
    }
    for (const key of Object.keys(tagData)) {
      const cleaned = cleanTagKey(key);
      if (cleaned !== "") {
        keys.add(cleaned);
      }
    }
  }

  const sorted = new Map<string, readonly string[]>();
  for (const [id, keys] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    sorted.set(
      id,
      [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  if (sorted.size === 0) {
    throw new Error("Tag database is empty");
  }
  return sorted;
}
