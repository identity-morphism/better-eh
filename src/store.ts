/**
 * One persistence seam for every small userscript store.
 *
 * A store owns the mechanics that used to be copied into each module: reading an unknown payload,
 * rejecting a record written by another version, validating the shape, and swallowing storage
 * failures. Each module still owns its key, its domain shape, and the policy that decides what a
 * fresh value is.
 *
 * Records are written as `{ version, values }`. Payloads written by the previous code (a raw array,
 * a raw string, or a module-specific envelope) are accepted by the payload guard, so the first
 * write silently migrates them to the shared envelope.
 */

import { createEmitter } from "./emitter";
import { isRecord } from "./guards";

export interface StorageAdapter {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface StoreOptions<T> {
  key: string;
  version: number;
  /** Fresh value for a missing, outdated or corrupt record. */
  empty: () => T;
  /** Shape guard for the payload. */
  guard: (value: unknown) => value is T;
}

export interface Store<T> {
  read(): T;
  write(value: T): void;
  /** Drop the stored record; the next read starts from `empty()`. */
  remove(): void;
}

/** One channel for a manager refusing a write, so the shell can tell the reader once. */
const storageFailures = createEmitter<void>();

/** Subscribe to a failed userscript-storage write. Returns the unsubscribe function. */
export function onStorageFailure(listener: () => void): () => void {
  return storageFailures.subscribe(listener);
}

function reportStorageFailure(): void {
  storageFailures.emit();
}

interface Envelope {
  version: number;
  values: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.version === "number" && "values" in value;
}

export function createStore<T>(options: StoreOptions<T>, adapter: StorageAdapter): Store<T> {
  const { key, version, empty, guard } = options;

  return {
    read(): T {
      try {
        const stored = adapter.read(key);
        if (isEnvelope(stored)) {
          return stored.version === version && guard(stored.values) ? stored.values : empty();
        }
        return guard(stored) ? stored : empty();
      } catch {
        return empty();
      }
    },

    write(value: T): void {
      try {
        adapter.write(key, { version, values: value });
      } catch {
        // Persistence is a convenience; the in-memory view keeps working without it.
        reportStorageFailure();
      }
    },

    remove(): void {
      try {
        adapter.remove(key);
      } catch {
        // Best effort: a failed delete leaves a value the guard will reject.
        reportStorageFailure();
      }
    },
  };
}

interface GreasemonkeyGlobals {
  GM_getValue?: (key: string, fallback?: unknown) => unknown;
  GM_setValue?: (key: string, value: unknown) => void;
  GM_deleteValue?: (key: string) => void;
}

/** Userscript value storage, resolved lazily so tests and sandboxed frames may replace it. */
export function gmStorage(): StorageAdapter {
  const globals = globalThis as unknown as GreasemonkeyGlobals;

  return {
    read(key) {
      try {
        return globals.GM_getValue?.(key, undefined);
      } catch {
        return undefined;
      }
    },

    write(key, value) {
      try {
        globals.GM_setValue?.(key, value);
      } catch {
        // Nothing useful to do when the storage manager refuses a write, but the shell can warn.
        reportStorageFailure();
      }
    },

    remove(key) {
      try {
        if (globals.GM_deleteValue) {
          globals.GM_deleteValue(key);
          return;
        }
        globals.GM_setValue?.(key, null);
      } catch {
        // Best effort: a missing deletion only leaves a value the guard will reject.
        reportStorageFailure();
      }
    },
  };
}

function decodeWebStorage(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Per-tab HTML storage, used for context that must not outlive the tab session. */
export function sessionStorageAdapter(): StorageAdapter {
  const storage = (): Storage | undefined => {
    try {
      return typeof globalThis.sessionStorage === "undefined"
        ? undefined
        : globalThis.sessionStorage;
    } catch {
      return undefined;
    }
  };

  return {
    read(key) {
      try {
        const raw = storage()?.getItem(key) ?? null;
        return raw === null ? undefined : decodeWebStorage(raw);
      } catch {
        return undefined;
      }
    },

    write(key, value) {
      try {
        storage()?.setItem(key, JSON.stringify(value));
      } catch {
        // The in-memory copy keeps working without persistence.
      }
    },

    remove(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        // The tab simply keeps its in-memory copy.
      }
    },
  };
}
