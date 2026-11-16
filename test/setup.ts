import type { StorageAdapter } from "../src/store";

const storage = new Map<string, unknown>();

const globals = globalThis as unknown as {
  GM_getValue: (key: string, fallback?: unknown) => unknown;
  GM_setValue: (key: string, value: unknown) => void;
};

globals.GM_getValue = (key, fallback) => (storage.has(key) ? storage.get(key) : fallback);
globals.GM_setValue = (key, value) => {
  storage.set(key, value);
};

export function storedValue(key: string): unknown {
  return storage.get(key);
}

export interface TestStorage extends StorageAdapter {
  readonly values: Map<string, unknown>;
}

/** An in-memory adapter with its own map, so tests never depend on global GM ordering. */
export function testStorage(seed: Record<string, unknown> = {}): TestStorage {
  const values = new Map(Object.entries(seed));
  return {
    values,
    read(key) {
      return values.get(key);
    },
    write(key, value) {
      values.set(key, value);
    },
    remove(key) {
      values.delete(key);
    },
  };
}
