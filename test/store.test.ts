import { describe, expect, test } from "bun:test";

import { createStore } from "../src/store";
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
