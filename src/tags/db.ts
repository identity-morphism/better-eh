/**
 * Local tag index used for search suggestions.
 *
 * The vocabulary comes from the community-maintained EhTagTranslation database (the same source
 * used by E-Hentai's translation userscripts). Only namespace and tag names are kept: the full
 * database is several megabytes, while the compact index is about one. It is cached in userscript
 * storage, so suggestions work offline after the first successful download. A generated core
 * vocabulary is embedded in the bundle as a synchronous fallback until that download lands.
 * Gallery-popularity counts are downloaded separately (see `counts.ts`) and attached when the index
 * is loaded.
 */

import { isRecord } from "../guards";
import { log, warn } from "../log";
import { createStore, gmStorage } from "../store";
import { coreVocabularyGroups } from "./core";
import { getTagCounts, loadTagCounts, onTagCountsChange } from "./counts";
import { decodeTagVocabulary } from "./index-codec";
import { ASSET_RETRY_MS, ASSET_TTL_MS, assetUrls, fetchAsset } from "./mirror";
import type { TagNamespace } from "./model";
import { cleanTagKey, fold, TAG_NAMESPACES } from "./model";
import type { CachedSnapshot } from "./snapshot";
import { createSnapshot } from "./snapshot";
import type { TagCounts } from "./tag-counts-codec";
import { tagKeyId } from "./tag-counts-codec";
import { vocabularyGroups } from "./vocabulary";

const CACHE_KEY = "eh:tag-index:v2";
const USAGE_KEY = "eh:tag-usage:v1";
export const TAG_COMPLETIONS_KEY = "eh:tag-completions:v1";
const CACHE_VERSION = 2;
const USAGE_LIMIT = 200;
const COMPLETION_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Picks older than this stop affecting ranking and are dropped from storage. */
export const COMPLETION_TTL_MS = 90 * DAY_MS;
/** A pick's weight halves every 30 days, so a one-off choice fades. */
export const COMPLETION_HALF_LIFE_MS = 30 * DAY_MS;
const DOWNLOAD_TIMEOUT_MS = 12_000;

const INDEX_URLS = assetUrls("tag-index.bin");

export interface TagEntry {
  readonly ns: TagNamespace;
  readonly key: string;
  readonly folded: string;
  /** Gallery count from the popularity snapshot; 0 when no snapshot is available. */
  readonly count: number;
}

export interface TagIndex {
  readonly entries: readonly TagEntry[];
  /** When the downloaded vocabulary was built. */
  readonly updated: number;
  readonly lookup: ReadonlyMap<string, TagEntry>;
  readonly byNamespace: ReadonlyMap<string, readonly TagEntry[]>;
  /** Largest popularity count in the snapshot, used to normalize ranking. */
  readonly maxCount: number;
}

/** How often a tag or prefix was picked, and when it was last picked. */
interface TimedCount {
  readonly count: number;
  readonly lastUsed: number;
}

export type TagUsage = TimedCount;
export type TagCompletion = TimedCount;

/** The (typed prefix, picked tag) pair the user confirmed from the combobox. */
export interface TagCompletionInput {
  /** Namespace of the typed phrase: `""` for an unqualified search. */
  readonly prefixNs: string;
  /** The folded phrase value the user typed, without namespace or sign. */
  readonly prefix: string;
  readonly ns: string;
  readonly key: string;
}

interface StoredIndex {
  readonly updated: number;
  readonly payload: Record<string, unknown>;
}

/** A built index together with the popularity snapshot already applied to it. */
interface BoundIndex {
  readonly index: TagIndex;
  readonly counts: TagCounts | null;
}

function isStoredIndex(value: unknown): value is StoredIndex {
  return isRecord(value) && typeof value.updated === "number" && isRecord(value.payload);
}

const indexStore = createStore<StoredIndex>(
  {
    key: CACHE_KEY,
    version: CACHE_VERSION,
    empty: () => ({ updated: 0, payload: {} }),
    guard: isStoredIndex,
  },
  gmStorage(),
);

const usageStore = createStore<Record<string, unknown>>(
  { key: USAGE_KEY, version: 1, empty: () => ({}), guard: isRecord },
  gmStorage(),
);

const completionStore = createStore<Record<string, unknown>>(
  { key: TAG_COMPLETIONS_KEY, version: 1, empty: () => ({}), guard: isRecord },
  gmStorage(),
);

/**
 * Storage identity for a tag: the raw cleaned key, so existing saved usage and completion records
 * keep resolving. Use `tagIdentity` from `model.ts` for matching.
 */
export function tagId(ns: string, key: string): string {
  return `${ns}\u0000${key}`;
}

/** Largest popularity count in a snapshot; 0 when there is none. */
function maxTagCount(counts: ReadonlyMap<number, number> | undefined): number {
  let max = 0;
  if (counts) {
    for (const count of counts.values()) {
      if (count > max) {
        max = count;
      }
    }
  }
  return max;
}

function buildIndex(
  groups: ReadonlyMap<string, readonly string[]>,
  updated: number,
  counts?: ReadonlyMap<number, number>,
): TagIndex {
  const entries: TagEntry[] = [];
  const byNamespace = new Map<string, TagEntry[]>();
  const lookup = new Map<string, TagEntry>();
  const maxCount = maxTagCount(counts);

  for (const namespace of TAG_NAMESPACES) {
    const keys = groups.get(namespace.id);
    if (!keys || keys.length === 0) {
      continue;
    }
    const scoped: TagEntry[] = [];
    for (const key of keys) {
      const folded = fold(key);
      const count = counts?.get(tagKeyId(folded)) ?? 0;
      const entry: TagEntry = { ns: namespace, key, folded, count };
      entries.push(entry);
      scoped.push(entry);
      lookup.set(tagId(namespace.id, key), entry);
    }
    scoped.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    byNamespace.set(namespace.id, scoped);
  }

  return { entries, updated, lookup, byNamespace, maxCount };
}

/** Build an index from already-cleaned namespace groups. */
function buildTagIndexFromGroups(
  groups: ReadonlyMap<string, readonly string[]>,
  updated = Date.now(),
  counts?: ReadonlyMap<number, number>,
): TagIndex {
  const index = buildIndex(groups, updated, counts);
  if (index.entries.length === 0) {
    throw new Error("Tag database is empty");
  }
  return index;
}

/** Build an index from the raw EhTagTranslation `db.html.json` payload. */
export function buildTagIndex(
  raw: unknown,
  updated = Date.now(),
  counts?: ReadonlyMap<number, number>,
): TagIndex {
  return buildTagIndexFromGroups(vocabularyGroups(raw), updated, counts);
}

/** The stored form of an index: namespace id to its cleaned keys. */
function encodeIndex(index: TagIndex): Record<string, string[]> {
  const payload: Record<string, string[]> = {};
  for (const [id, entries] of index.byNamespace) {
    payload[id] = entries.map((entry) => entry.key);
  }
  return payload;
}

/** Rebuild an index from stored keys; returns `null` when nothing usable is left. */
function decodeIndex(
  payload: Record<string, unknown>,
  updated: number,
  counts: ReadonlyMap<number, number> | undefined,
): TagIndex | null {
  const groups = new Map<string, readonly string[]>();
  for (const [id, keys] of Object.entries(payload)) {
    if (Array.isArray(keys)) {
      groups.set(
        id,
        keys
          .filter((key): key is string => typeof key === "string")
          .map(cleanTagKey)
          .filter((key) => key !== ""),
      );
    }
  }

  const index = buildIndex(groups, updated, counts);
  return index.entries.length === 0 ? null : index;
}

/** Rebuild an index with a different popularity map, preserving entry order. */
function withTagCounts(
  current: TagIndex,
  counts: ReadonlyMap<number, number> | undefined,
): TagIndex {
  if (!counts) {
    return current;
  }
  const maxCount = maxTagCount(counts);
  if (maxCount === 0) {
    return current;
  }

  const entries = current.entries.map((entry) => ({
    ...entry,
    count: counts.get(tagKeyId(entry.folded)) ?? 0,
  }));
  const lookup = new Map<string, TagEntry>();
  const byNamespace = new Map<string, TagEntry[]>();
  for (const entry of entries) {
    lookup.set(tagId(entry.ns.id, entry.key), entry);
    const scoped = byNamespace.get(entry.ns.id);
    if (scoped) {
      scoped.push(entry);
    } else {
      byNamespace.set(entry.ns.id, [entry]);
    }
  }
  return { entries, updated: current.updated, lookup, byNamespace, maxCount };
}

function readIndexCache(): CachedSnapshot<BoundIndex> | null {
  const stored = indexStore.read();
  const counts = getTagCounts();
  const index = decodeIndex(stored.payload, stored.updated, counts?.counts);
  return index ? { value: { index, counts }, updated: stored.updated } : null;
}

/** The embedded vocabulary as an index; built on first use and never persisted. */
let core: TagIndex | null | undefined;

function coreIndex(): TagIndex | null {
  if (core === undefined) {
    const groups = coreVocabularyGroups();
    core = groups === null ? null : buildTagIndexFromGroups(groups, 0);
  }
  return core;
}

async function fetchVocabulary(): Promise<Map<string, readonly string[]>> {
  const { value } = await fetchAsset(INDEX_URLS, decodeTagVocabulary, {
    label: "Tag index mirror",
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  return value;
}

async function fetchIndex(): Promise<BoundIndex> {
  try {
    const vocabulary = await fetchVocabulary();
    const counts = getTagCounts();
    const index = buildTagIndexFromGroups(vocabulary, Date.now(), counts?.counts);
    log(`Tag index downloaded: ${index.entries.length} tags`);
    return { index, counts };
  } catch (error) {
    warn("Tag vocabulary download failed", error);
    throw error;
  }
}

const indexSnapshot = createSnapshot<BoundIndex>({
  label: "tag index",
  ttlMs: ASSET_TTL_MS,
  retryMs: ASSET_RETRY_MS,
  load: fetchIndex,
  readCache: readIndexCache,
  writeCache: (bound, updated) => {
    indexStore.write({ updated, payload: encodeIndex(bound.index) });
  },
  onError: "throw",
});

/** Subscribe to a newly served index: a fresh download or a refreshed popularity snapshot. */
export function onTagIndexChange(listener: () => void): () => void {
  return indexSnapshot.onChange(listener);
}

function applyTagCounts(counts: TagCounts): void {
  const current = indexSnapshot.get();
  if (!current || current.counts === counts) {
    return;
  }
  const next = withTagCounts(current.index, counts.counts);
  if (next === current.index) {
    return;
  }
  indexSnapshot.publish({ index: next, counts });
}

onTagCountsChange(applyTagCounts);

/**
 * The cached full index or, until one is downloaded, the embedded core. Reads local data only;
 * never touches the network.
 */
export function getTagIndex(): TagIndex | null {
  return indexSnapshot.get()?.index ?? coreIndex();
}

/**
 * Forget the in-memory index; the next read consults storage again. The embedded core remains
 * available.
 */
export function resetTagIndex(): void {
  indexSnapshot.reset();
}

/**
 * Return the index, downloading it when no local copy exists. A stale local copy is served
 * immediately and refreshed in the background so opening the search field never waits on the CDN.
 * Without any cache the embedded core is served at once and the full download continues in the
 * background. A forced load always awaits the download and throws when it fails.
 */
export async function loadTagIndex(force = false): Promise<TagIndex> {
  void loadTagCounts().catch((error: unknown) => {
    warn("Tag popularity refresh failed", error);
  });

  if (!force) {
    const cached = indexSnapshot.get();
    if (cached) {
      const loaded = await indexSnapshot.load(false);
      return loaded?.index ?? cached.index;
    }

    const fallback = coreIndex();
    if (fallback) {
      void indexSnapshot.load(false).catch((error: unknown) => {
        warn("Tag index background download failed", error);
      });
      return fallback;
    }
  }

  const loaded = await indexSnapshot.load(force);
  if (!loaded) {
    throw new Error("Could not load the tag index");
  }
  return loaded.index;
}

/**
 * The timed-count records in `stored`, dropping malformed entries and, when `ttl` is given, picks
 * older than it. Expired picks stay on disk until the store is next written.
 */
function readTimedCounts(
  stored: Record<string, unknown>,
  ttl?: number,
  now = Date.now(),
): Map<string, TimedCount> {
  const counts = new Map<string, TimedCount>();
  for (const [id, value] of Object.entries(stored)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const count = "count" in value ? value.count : null;
    const lastUsed = "lastUsed" in value ? value.lastUsed : null;
    if (typeof count !== "number" || typeof lastUsed !== "number") {
      continue;
    }
    if (ttl !== undefined && now - lastUsed >= ttl) {
      continue;
    }
    counts.set(id, { count, lastUsed });
  }
  return counts;
}

/** Drop the oldest entries past `limit`, then persist the survivors. */
function writePruned(
  counts: Map<string, TimedCount>,
  limit: number,
  write: (value: Record<string, TimedCount>) => void,
): void {
  if (counts.size > limit) {
    const oldest = [...counts.entries()]
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
      .slice(0, counts.size - limit);
    for (const [idToDrop] of oldest) {
      counts.delete(idToDrop);
    }
  }
  write(Object.fromEntries(counts));
}

let usage: Map<string, TagUsage> | null = null;

function readUsage(): Map<string, TagUsage> {
  if (usage) {
    return usage;
  }
  usage = readTimedCounts(usageStore.read());
  return usage;
}

/** Tags the user picked before, for recency ranking and the empty-query state. */
export function tagUsage(): ReadonlyMap<string, TagUsage> {
  return readUsage();
}

/** Remember a picked tag so it ranks higher next time. */
export function recordTagUse(ns: string, key: string): void {
  const current = readUsage();
  const id = tagId(ns, key);
  const previous = current.get(id);
  current.set(id, {
    count: (previous?.count ?? 0) + 1,
    lastUsed: Date.now(),
  });
  writePruned(current, USAGE_LIMIT, (value) => usageStore.write(value));
}

/**
 * Identity of a remembered completion: the same tag can be preferred for different prefixes and
 * namespace-scoped searches without leaking between them.
 */
function normalizePrefix(prefix: string): string {
  return fold(prefix).trim();
}

export function completionId(input: TagCompletionInput): string {
  return [input.prefixNs, normalizePrefix(input.prefix), input.ns, input.key].join("\u0000");
}

/** Prefix completions the user confirmed, keyed by {@link completionId}. */
export function tagCompletions(now = Date.now()): ReadonlyMap<string, TagCompletion> {
  return readTimedCounts(completionStore.read(), COMPLETION_TTL_MS, now);
}

/** Remember that the user picked `key` for this prefix. */
export function recordTagCompletion(input: TagCompletionInput, now = Date.now()): void {
  if (normalizePrefix(input.prefix) === "") {
    return;
  }
  const completions = readTimedCounts(completionStore.read(), COMPLETION_TTL_MS, now);
  const id = completionId(input);
  const previous = completions.get(id);
  completions.set(id, { count: (previous?.count ?? 0) + 1, lastUsed: now });
  writePruned(completions, COMPLETION_LIMIT, (value) => completionStore.write(value));
}
