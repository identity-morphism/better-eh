/**
 * Recent queries.
 *
 * Deduplicated by their normalized text (case and whitespace ignored, so the same search is not
 * stored twice), capped, and expiring. Named quick tags live in `quick-tags`.
 */

import { isUnknownArray } from "../guards";
import { createStore, gmStorage } from "../store";

const HISTORY_KEY = "eh:search-history:v1";
const VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RECENT_LIMIT = 20;
export const RECENT_TTL_MS = 90 * DAY_MS;

interface RecentQuery {
  text: string;
  usedAt: number;
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isRecent(value: unknown): value is RecentQuery {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.text === "string" && typeof record.usedAt === "number";
}

const historyStore = createStore<unknown[]>(
  { key: HISTORY_KEY, version: VERSION, empty: () => [], guard: isUnknownArray },
  gmStorage(),
);

/** Recent queries, newest first, without duplicates or expired entries. */
export function recentQueries(now = Date.now()): RecentQuery[] {
  const seen = new Set<string>();
  const recent: RecentQuery[] = [];
  for (const value of historyStore.read()) {
    if (!isRecent(value) || now - value.usedAt >= RECENT_TTL_MS) {
      continue;
    }
    const text = normalize(value.text);
    const key = text.toLowerCase();
    if (text === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    recent.push({ text, usedAt: value.usedAt });
  }
  return recent.slice(0, RECENT_LIMIT);
}

/** Remember a submitted query, moving a repeat to the front. */
export function rememberQuery(text: string, now = Date.now()): void {
  const normalized = normalize(text);
  if (normalized === "") {
    return;
  }
  const key = normalized.toLowerCase();
  const next = recentQueries(now).filter((entry) => entry.text.toLowerCase() !== key);
  next.unshift({ text: normalized, usedAt: now });
  historyStore.write(next.slice(0, RECENT_LIMIT));
}

/** Forget every recent query; saved expressions are untouched. */
export function clearRecentQueries(): void {
  historyStore.write([]);
}
