/**
 * Named search expressions.
 *
 * A saved search and a quick tag store the same thing: a name and a query. A `run` saved search
 * replaces the field and searches; a `toggle` expression adds or removes its terms, and a quick tag
 * (a pinned expression) always toggles. `pinned` decides whether the expression also renders as a
 * button under the search field, so one store feeds both surfaces.
 */

import { isUnknownArray } from "../guards";
import { createStore, gmStorage } from "../store";

export type ExpressionMode = "run" | "toggle";

export interface SavedExpression {
  name: string;
  query: string;
  mode: ExpressionMode;
  /** Renders as a quick-tag button under the search field. */
  pinned: boolean;
  savedAt: number;
}

const KEY = "eh:saved-expressions:v1";
const LEGACY_QUICK_TAGS = "eh:quick-tags:v1";
const LEGACY_SAVED_SEARCHES = "eh:saved-searches:v1";
const VERSION = 1;
export const EXPRESSION_LIMIT = 30;

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isMode(value: unknown): value is ExpressionMode {
  return value === "run" || value === "toggle";
}

/** A quick tag has no run verb: pinning an expression makes it a toggle. */
function expressionMode(mode: ExpressionMode, pinned: boolean): ExpressionMode {
  return pinned ? "toggle" : mode;
}

function isExpression(value: unknown): value is SavedExpression {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.query === "string" &&
    isMode(record.mode) &&
    typeof record.pinned === "boolean" &&
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
 * Move the old quick tags and saved searches into the one store.
 *
 * The legacy keys are removed after the write, so deleting every expression later cannot resurrect
 * them. A write failure leaves the old keys for the next read.
 */
function migrateLegacy(): void {
  const quick = legacyValues(LEGACY_QUICK_TAGS).flatMap((value): SavedExpression[] => {
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
    return [
      {
        name: normalize(record.label) || query,
        query,
        mode: "toggle",
        pinned: true,
        savedAt: 0,
      },
    ];
  });

  const saved = legacyValues(LEGACY_SAVED_SEARCHES).flatMap((value): SavedExpression[] => {
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
        mode: "run",
        pinned: false,
        savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
      },
    ];
  });

  if (quick.length === 0 && saved.length === 0) {
    return;
  }
  store.write([...quick, ...saved].slice(0, EXPRESSION_LIMIT));
  gmStorage().remove(LEGACY_QUICK_TAGS);
  gmStorage().remove(LEGACY_SAVED_SEARCHES);
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notify both surfaces after any write, so the chip row and the history panel cannot disagree. */
export function subscribeExpressions(listener: Listener): () => void {
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

/** Every saved expression, newest first. */
export function savedExpressions(): SavedExpression[] {
  let values = store.read();
  if (values.length === 0) {
    migrateLegacy();
    values = store.read();
  }
  return values
    .filter(isExpression)
    .map((entry) => {
      const pinned = entry.pinned;
      return {
        name: normalize(entry.name),
        query: normalize(entry.query),
        mode: expressionMode(entry.mode, pinned),
        pinned,
        savedAt: entry.savedAt,
      };
    })
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, EXPRESSION_LIMIT);
}

/** Expressions the quick-tag row renders. A quick tag always toggles its terms. */
export function quickExpressions(): SavedExpression[] {
  return savedExpressions().filter((entry) => entry.pinned && entry.mode === "toggle");
}

/** Remove one expression by name. */
export function removeExpression(name: string): void {
  const key = normalize(name).toLowerCase();
  store.write(savedExpressions().filter((entry) => entry.name.toLowerCase() !== key));
  notify();
}

/** Replace the whole list, as the editor does after adding, editing and removing rows. */
export function replaceExpressions(expressions: readonly SavedExpression[]): void {
  const next = expressions
    .map((entry) => {
      const pinned = entry.pinned === true;
      return {
        name: normalize(entry.name),
        query: normalize(entry.query),
        mode: expressionMode(entry.mode, pinned),
        pinned,
        savedAt: entry.savedAt,
      };
    })
    .filter((entry) => entry.name !== "" && entry.query !== "")
    .slice(0, EXPRESSION_LIMIT);
  store.write(next);
  notify();
}
