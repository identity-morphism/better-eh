import { afterAll, describe, expect, test } from "bun:test";

import { createStore, gmStorage, onStorageFailure, sessionStorageAdapter } from "../src/store";
import type { StorageAdapter, Store } from "../src/store";
import { testStorage } from "./setup";

const KEY = "eh:test:v1";
const VERSION = 3;

function isNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function numbersStore(adapter: StorageAdapter): Store<number[]> {
  return createStore<number[]>(
    { key: KEY, version: VERSION, empty: () => [], guard: isNumbers },
    adapter,
  );
}

describe("the shared store", () => {
  test("returns the fresh value for a missing key", () => {
    const store = numbersStore(testStorage());

    expect(store.read()).toEqual([]);
  });

  test("rejects a record written by another version", () => {
    const storage = testStorage({ [KEY]: { version: VERSION - 1, values: [1, 2] } });
    const store = numbersStore(storage);

    expect(store.read()).toEqual([]);
    expect(storage.values.get(KEY)).toEqual({ version: VERSION - 1, values: [1, 2] });
  });

  test("rejects a payload the guard does not recognise", () => {
    expect(numbersStore(testStorage({ [KEY]: "not a list" })).read()).toEqual([]);
    expect(
      numbersStore(testStorage({ [KEY]: { version: VERSION, values: { nope: true } } })).read(),
    ).toEqual([]);
  });

  test("reads a legacy payload and migrates it on the first write", () => {
    const storage = testStorage({ [KEY]: [7, 8] });
    const store = numbersStore(storage);

    expect(store.read()).toEqual([7, 8]);

    store.write([9]);
    expect(storage.values.get(KEY)).toEqual({ version: VERSION, values: [9] });
    expect(store.read()).toEqual([9]);
  });

  test("reads values inside a matching envelope", () => {
    const storage = testStorage({ [KEY]: { version: VERSION, values: [5] } });

    expect(numbersStore(storage).read()).toEqual([5]);
  });

  test("removes the record through the adapter", () => {
    const storage = testStorage({ [KEY]: { version: VERSION, values: [1] } });
    const store = numbersStore(storage);

    store.remove();

    expect(storage.values.has(KEY)).toBe(false);
    expect(store.read()).toEqual([]);
  });

  test("contains adapter failures instead of propagating them", () => {
    const adversarial: StorageAdapter = {
      read() {
        throw new Error("read denied");
      },
      write() {
        throw new Error("write denied");
      },
      remove() {
        throw new Error("remove denied");
      },
    };
    const store = numbersStore(adversarial);

    expect(store.read()).toEqual([]);
    expect(() => store.write([1])).not.toThrow();
  });
});

interface GmGlobals {
  GM_getValue?: (key: string, fallback?: unknown) => unknown;
  GM_setValue?: (key: string, value: unknown) => void;
  GM_deleteValue?: (key: string) => void;
}

describe("the userscript storage adapter", () => {
  const globals = globalThis as unknown as GmGlobals;

  test("reads, writes and deletes through the manager", () => {
    const values = new Map<string, unknown>();
    const deleted: string[] = [];
    globals.GM_getValue = (key, fallback) => (values.has(key) ? values.get(key) : fallback);
    globals.GM_setValue = (key, value) => {
      values.set(key, value);
    };
    globals.GM_deleteValue = (key) => {
      deleted.push(key);
      values.delete(key);
    };
    const storage = gmStorage();

    storage.write("k", { a: 1 });
    expect(storage.read("k")).toEqual({ a: 1 });
    storage.remove("k");
    expect(deleted).toEqual(["k"]);
    expect(storage.read("k")).toBeUndefined();
  });

  test("falls back to writing null when the manager has no delete API", () => {
    const values = new Map<string, unknown>();
    globals.GM_getValue = (key, fallback) => (values.has(key) ? values.get(key) : fallback);
    globals.GM_setValue = (key, value) => {
      values.set(key, value);
    };
    globals.GM_deleteValue = undefined;
    const storage = gmStorage();

    storage.write("k", 1);
    storage.remove("k");

    expect(values.get("k")).toBeNull();
  });

  test("reports a refused manager write once per listener", () => {
    let failures = 0;
    const stop = onStorageFailure(() => {
      failures += 1;
    });
    globals.GM_setValue = () => {
      throw new Error("quota");
    };

    gmStorage().write("k", 1);
    stop();

    expect(failures).toBe(1);
  });

  test("contains a throwing manager", () => {
    globals.GM_getValue = () => {
      throw new Error("read denied");
    };
    globals.GM_setValue = () => {
      throw new Error("write denied");
    };
    globals.GM_deleteValue = () => {
      throw new Error("delete denied");
    };
    const storage = gmStorage();

    expect(storage.read("k")).toBeUndefined();
    expect(() => storage.write("k", 1)).not.toThrow();
    expect(() => storage.remove("k")).not.toThrow();
  });
});

describe("the tab storage adapter", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

  afterAll(() => {
    if (descriptor === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).sessionStorage;
      return;
    }
    Object.defineProperty(globalThis, "sessionStorage", descriptor);
  });

  test("reads JSON, keeps a raw string and writes or removes through the tab store", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });
    const storage = sessionStorageAdapter();

    storage.write("a", { n: 1 });
    expect(values.get("a")).toBe('{"n":1}');
    expect(storage.read("a")).toEqual({ n: 1 });
    values.set("raw", "not json");
    expect(storage.read("raw")).toBe("not json");
    expect(storage.read("missing")).toBeUndefined();
    storage.remove("a");
    expect(storage.read("a")).toBeUndefined();
  });

  test("contains a throwing tab store", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("read denied");
        },
        setItem: () => {
          throw new Error("write denied");
        },
        removeItem: () => {
          throw new Error("remove denied");
        },
      },
    });
    const storage = sessionStorageAdapter();

    expect(storage.read("a")).toBeUndefined();
    expect(() => storage.write("a", 1)).not.toThrow();
    expect(() => storage.remove("a")).not.toThrow();
  });
});
