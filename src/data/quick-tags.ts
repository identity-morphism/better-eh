/**
 * Named quick tags.
 *
 * A quick tag is a name plus a search expression. Clicking one adds the expression's terms to the
 * current search, or removes them when every term is already present. The storage key keeps its
 * original `saved-expressions` name so quick tags saved before saved searches were removed still
 * load; the old saved-search records are imported as quick tags once.
 */

import { isUnknownArray } from "../guards";
import { createStore, gmStorage } from "../store";

export interface QuickTag {
  name: string;
  query: string;
  savedAt: number;
}

const KEY = "eh:saved-expressions:v1";
const LEGACY_QUICK_TAGS = "eh:quick-tags:v1";
const LEGACY_SAVED_SEARCHES = "eh:saved-searches:v1";
const VERSION = 1;
export const QUICK_TAG_LIMIT = 30;

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Old records also carry `mode` and `pinned`; extra fields are ignored, not rejected. */
function isQuickTag(value: unknown): value is QuickTag {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.query === "string" &&
    typeof record.savedAt === "number"
  );
}

const store = createStore<unknown[]>(
  { key: KEY, version: VERSION, empty: () => [], guard: isUnknownArray },
  gmStorage(),
);

/** Payload of a legacy store: a raw array, or the shared `{version, values}` envelope. */
function legacyValues(key: string): unknown[] {
  const raw = gmStorage().read(key);
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "object" && raw !== null && "values" in raw) {
    const values = raw.values;
    return Array.isArray(values) ? values : [];
  }
  return [];
}

/**
 * Move the old quick tags and saved searches into the quick-tag store.
 *
 * Saved searches become quick tags too: they keep their name and query, but now toggle their terms.
 * The legacy keys are removed after the write, so deleting every quick tag later cannot resurrect
 * them. A write failure leaves the old keys for the next read.
 */
function migrateLegacy(): void {
  const quick = legacyValues(LEGACY_QUICK_TAGS).flatMap((value): QuickTag[] => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const record = value as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.query !== "string") {
      return [];
    }
    const query = normalize(record.query);
    if (query === "") {
      return [];
    }
    return [{ name: normalize(record.label) || query, query, savedAt: 0 }];
  });

  const saved = legacyValues(LEGACY_SAVED_SEARCHES).flatMap((value): QuickTag[] => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const record = value as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.text !== "string") {
      return [];
    }
    const query = normalize(record.text);
    const name = normalize(record.name);
    if (query === "" || name === "") {
      return [];
    }
    return [
      {
        name,
        query,
        savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
      },
    ];
  });

  if (quick.length === 0 && saved.length === 0) {
    return;
  }
  store.write([...quick, ...saved].slice(0, QUICK_TAG_LIMIT));
  gmStorage().remove(LEGACY_QUICK_TAGS);
  gmStorage().remove(LEGACY_SAVED_SEARCHES);
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notify every quick-tag surface after a write so the chip row and history panel agree. */
export function subscribeQuickTags(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Every quick tag, newest first. */
export function quickTags(): QuickTag[] {
  let values = store.read();
  if (values.length === 0) {
    migrateLegacy();
    values = store.read();
  }
  return values
    .filter(isQuickTag)
    .map((entry) => ({
      name: normalize(entry.name),
      query: normalize(entry.query),
      savedAt: entry.savedAt,
    }))
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, QUICK_TAG_LIMIT);
}

/** Remove one quick tag by name. */
export function removeQuickTag(name: string): void {
  const key = normalize(name).toLowerCase();
  store.write(quickTags().filter((entry) => entry.name.toLowerCase() !== key));
  notify();
}

/** Replace the whole list, as the editor does after adding, renaming and removing rows. */
export function replaceQuickTags(tags: readonly QuickTag[]): void {
  const next = tags
    .map((entry) => ({
      name: normalize(entry.name),
      query: normalize(entry.query),
      savedAt: entry.savedAt,
    }))
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .slice(0, QUICK_TAG_LIMIT);
  store.write(next);
  notify();
}
