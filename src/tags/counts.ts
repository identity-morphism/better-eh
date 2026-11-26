/**
 * Tag popularity: cached remote asset.
 *
 * The runtime loads `assets/tag-counts.bin` from this repository over plain `fetch` (raw GitHub and
 * jsDelivr both send CORS headers), so weekly data refreshes do not need a userscript release.
 * Until the first successful download there is no snapshot, so ranking falls back to match quality
 * alone.
 */

import { isRecord } from "../guards";
import { log } from "../log";
import { createStore, gmStorage } from "../store";
import { base64FromBytes } from "./base64";
import { ASSET_RETRY_MS, ASSET_TTL_MS, assetUrls, fetchAsset } from "./mirror";
import type { CachedSnapshot } from "./snapshot";
import { createSnapshot } from "./snapshot";
import type { TagCounts } from "./tag-counts-codec";
import { decodeTagCounts, decodeTagCountsFromBytes } from "./tag-counts-codec";

const CACHE_KEY = "eh:tag-counts:v3";
const CACHE_VERSION = 3;
const REMOTE_URLS = assetUrls("tag-counts.bin");

interface StoredCounts {
  readonly updated: number;
  readonly payload: string;
}

/** A decoded snapshot plus the bytes it came from, kept so the cache can be written verbatim. */
interface CachedCounts {
  readonly counts: TagCounts;
  readonly payload: string;
}

function isStoredCounts(value: unknown): value is StoredCounts {
  return isRecord(value) && typeof value.updated === "number" && typeof value.payload === "string";
}

const countsStore = createStore<StoredCounts>(
  {
    key: CACHE_KEY,
    version: CACHE_VERSION,
    empty: () => ({ updated: 0, payload: "" }),
    guard: isStoredCounts,
  },
  gmStorage(),
);

function readCountsCache(): CachedSnapshot<CachedCounts> | null {
  const stored = countsStore.read();
  if (stored.payload === "") {
    return null;
  }
  const counts = decodeTagCounts(stored.payload);
  return counts ? { value: { counts, payload: stored.payload }, updated: stored.updated } : null;
}

async function fetchCounts(): Promise<CachedCounts> {
  const { value, bytes } = await fetchAsset(REMOTE_URLS, decodeTagCountsFromBytes, {
    label: "Tag count mirror",
    timeoutMs: 12_000,
  });
  log(`Tag counts refreshed: ${value.counts.size} tags`);
  return { counts: value, payload: base64FromBytes(bytes) };
}

const countsSnapshot = createSnapshot<CachedCounts>({
  label: "tag counts",
  ttlMs: ASSET_TTL_MS,
  retryMs: ASSET_RETRY_MS,
  load: fetchCounts,
  readCache: readCountsCache,
  writeCache: (cached, updated) => {
    countsStore.write({ updated, payload: cached.payload });
  },
  onError: "cached",
});

/** The best synchronous snapshot: only data downloaded and cached earlier. */
export function getTagCounts(): TagCounts | null {
  return countsSnapshot.get()?.counts ?? null;
}

/** Forget the in-memory counts; the next read consults storage again. */
export function resetTagCounts(): void {
  countsSnapshot.reset();
}

/** Drop the downloaded popularity snapshot from memory and userscript storage. */
export function clearTagCountsCache(): void {
  resetTagCounts();
  countsStore.remove();
}

/** Subscribe to a refreshed snapshot. Returns an unsubscribe function. */
export function onTagCountsChange(listener: (value: TagCounts) => void): () => void {
  return countsSnapshot.onChange((cached) => {
    listener(cached.counts);
  });
}

/**
 * Return the cached snapshot, fetching the remote asset when the local copy is stale or absent.
 * Callers generally invoke this in the background while suggestions use {@link getTagCounts}.
 */
export function loadTagCounts(force = false): Promise<TagCounts | null> {
  return countsSnapshot.load(force).then((cached) => cached?.counts ?? null);
}
