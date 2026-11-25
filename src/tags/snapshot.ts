/**
 * One reusable policy for a remote value kept in userscript storage.
 *
 * The tag index and the tag popularity snapshot both download a repository asset, cache it, and
 * serve the cached copy synchronously. This module owns that shared policy: the cache read that
 * stops once a value is found, the freshness and retry windows, a single in-flight download with a
 * generation guard so a superseded download cannot publish or clear the current one, and the change
 * listeners. Adapters own the stored payload, how it is decoded, and what a failed download means
 * for their callers.
 */

import { createEmitter } from "../emitter";
import { warn } from "../log";

/** A value read from storage together with the time it was stored. */
export interface CachedSnapshot<T> {
  readonly value: T;
  readonly updated: number;
}

export interface SnapshotOptions<T> {
  /** Lower-case name used in log lines, e.g. `"tag counts"`. */
  label: string;
  /** How long a published value is trusted before a refresh is attempted. */
  ttlMs: number;
  /** How long any attempt suppresses the next one. */
  retryMs: number;
  /** Download the asset and decode it. */
  load: () => Promise<T>;
  /** Read the stored value synchronously; `null` when absent or unusable. */
  readCache: () => CachedSnapshot<T> | null;
  /** Persist a downloaded value and its stamp. */
  writeCache: (value: T, updated: number) => void;
  /** What a failed download does: reject the load, or resolve with the cached value. */
  onError: "throw" | "cached";
}

export interface Snapshot<T> {
  /**
   * The cached value, reading storage until one is found. Never touches the network, and stops
   * reading storage once a value is known.
   */
  get(): T | null;
  /** When the current value was stored; `0` when nothing has been cached. */
  updated(): number;
  /**
   * Serve a fresh enough cached value immediately and refresh a stale one in the background;
   * download and wait only when there is nothing to serve. `force` always downloads and supersedes
   * an in-flight download.
   */
  load(force?: boolean): Promise<T | null>;
  /** Observe newly downloaded or published values. Returns the unsubscribe function. */
  onChange(listener: (value: T) => void): () => void;
  /** Replace the in-memory value without touching the cache, e.g. after binding a newer sidecar. */
  publish(value: T): void;
  /**
   * Forget the in-memory value and the remembered storage read; the next `get` or `load` consults
   * storage again. A superseded download can no longer publish.
   */
  reset(): void;
}

export function createSnapshot<T>(options: SnapshotOptions<T>): Snapshot<T> {
  const { label, ttlMs, retryMs, load: download, readCache, writeCache, onError } = options;

  let current: CachedSnapshot<T> | null = null;
  let cacheRead = false;
  let inFlight: Promise<T | null> | null = null;
  /** Identifies the newest download, so a superseded one cannot publish or clear it. */
  let generation = 0;
  let lastAttempt = 0;
  const listeners = createEmitter<T>();

  /**
   * The synchronous cache read shared by every reader. An empty storage read is retried, so a value
   * written after the first access (by another tab, or a test seeding storage) is still served;
   * once a value is known, storage is not read again.
   */
  function cached(): CachedSnapshot<T> | null {
    if (!cacheRead) {
      current = readCache();
      cacheRead = current !== null;
    }
    return current;
  }

  function notify(value: T): void {
    listeners.emit(value);
  }

  function start(background: boolean): Promise<T | null> {
    const token = ++generation;
    lastAttempt = Date.now();

    // Start the request in this tick; a synchronous throw from an adapter is still a rejection.
    let request: Promise<T>;
    try {
      request = download();
    } catch (error) {
      request = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const pending = request
      .then((value) => {
        if (token !== generation) {
          return cached()?.value ?? value;
        }
        const updated = Date.now();
        current = { value, updated };
        cacheRead = true;
        writeCache(value, updated);
        notify(value);
        return value;
      })
      .catch((error: unknown) => {
        if (onError === "cached") {
          if (token === generation) {
            warn(`${label} refresh failed`, error);
          }
          return cached()?.value ?? null;
        }
        throw error;
      })
      .finally(() => {
        if (token === generation) {
          inFlight = null;
        }
      });

    inFlight = pending;
    if (background) {
      void pending.catch((error: unknown) => {
        warn(`Background ${label} refresh failed`, error);
      });
    }
    return pending;
  }

  function loadFromCache(force = false): Promise<T | null> {
    const cachedValue = cached();
    const now = Date.now();

    if (force) {
      return start(false);
    }
    if (cachedValue) {
      if (now - cachedValue.updated <= ttlMs) {
        return Promise.resolve(cachedValue.value);
      }
      if (inFlight || now - lastAttempt <= retryMs) {
        return Promise.resolve(cachedValue.value);
      }
      void start(true);
      return Promise.resolve(cachedValue.value);
    }
    if (inFlight) {
      return inFlight;
    }
    return start(false);
  }

  return {
    get(): T | null {
      return cached()?.value ?? null;
    },

    updated(): number {
      return cached()?.updated ?? 0;
    },

    load: loadFromCache,

    onChange(listener: (value: T) => void): () => void {
      return listeners.subscribe(listener);
    },

    publish(value: T): void {
      const known = cached();
      current = { value, updated: known?.updated ?? Date.now() };
      cacheRead = true;
      notify(value);
    },

    reset(): void {
      generation++;
      current = null;
      cacheRead = false;
      inFlight = null;
      lastAttempt = 0;
    },
  };
}
