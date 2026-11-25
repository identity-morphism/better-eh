/**
 * Named quick tags.
 *
 * A quick tag is a name plus a search expression. Clicking one adds the expression's terms to the
 * current search, or removes them when every term is already present. The storage key keeps its
 * original `saved-expressions` name so quick tags saved under it keep loading.
 */

import type { Unsubscribe } from "../emitter";
import { createEmitter } from "../emitter";
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

const quickTagsChanged = createEmitter<void>();

/** Notify every quick-tag surface after a write so the chip row and history panel agree. */
export function subscribeQuickTags(listener: () => void): Unsubscribe {
  return quickTagsChanged.subscribe(listener);
}

function notify(): void {
  quickTagsChanged.emit();
}

/** Stored entries reduced to the shape the app shows: trimmed, and never blank. */
function cleanTags(values: readonly QuickTag[]): QuickTag[] {
  return values
    .map((entry) => ({
      name: collapseWhitespace(entry.name),
      query: collapseWhitespace(entry.query),
      savedAt: entry.savedAt,
    }))
    .filter((entry) => entry.name !== "" && entry.query !== "");
}

/** Every quick tag, newest first. */
export function quickTags(): QuickTag[] {
  return cleanTags(store.read().filter(isQuickTag))
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
  store.write(cleanTags(tags).slice(0, QUICK_TAG_LIMIT));
  notify();
}
