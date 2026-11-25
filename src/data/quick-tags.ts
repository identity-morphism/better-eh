/**
 * Named quick tags.
 *
 * A quick tag is a name plus a search expression. Clicking one adds the expression's terms to the
 * current search, or removes them when every term is already present. The storage key keeps its
 * original `saved-expressions` name so quick tags saved under it keep loading.
 */

import { isUnknownArray } from "../guards";
import { createStore, gmStorage } from "../store";
import { collapseWhitespace } from "../strings";

export interface QuickTag {
  name: string;
  query: string;
  savedAt: number;
}

const KEY = "eh:saved-expressions:v1";
const VERSION = 1;
export const QUICK_TAG_LIMIT = 30;

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
  return store
    .read()
    .filter(isQuickTag)
    .map((entry) => ({
      name: collapseWhitespace(entry.name),
      query: collapseWhitespace(entry.query),
      savedAt: entry.savedAt,
    }))
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, QUICK_TAG_LIMIT);
}

/** Remove one quick tag by name. */
export function removeQuickTag(name: string): void {
  const key = collapseWhitespace(name).toLowerCase();
  store.write(quickTags().filter((entry) => entry.name.toLowerCase() !== key));
  notify();
}

/** Replace the whole list, as the editor does after adding, renaming and removing rows. */
export function replaceQuickTags(tags: readonly QuickTag[]): void {
  const next = tags
    .map((entry) => ({
      name: collapseWhitespace(entry.name),
      query: collapseWhitespace(entry.query),
      savedAt: entry.savedAt,
    }))
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .slice(0, QUICK_TAG_LIMIT);
  store.write(next);
  notify();
}
