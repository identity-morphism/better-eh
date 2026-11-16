import { describe, expect, test } from "bun:test";

import { createLru } from "../../src/fetch/lru";

describe("createLru", () => {
  test("keeps at most the limit and drops the oldest entry", () => {
    const lru = createLru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
  });

  test("a hit makes the entry the most recently used", () => {
    const lru = createLru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a");
    lru.set("c", 3);

    expect(lru.get("a")).toBe(1);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("c")).toBe(3);
  });

  test("overwriting an entry does not evict another one", () => {
    const lru = createLru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("a", 10);

    expect(lru.get("a")).toBe(10);
    expect(lru.get("b")).toBe(2);
  });

  test("reports the evicted entry to the callback", () => {
    const evicted: Array<[string, number]> = [];
    const lru = createLru<string, number>(2, (value, key) => evicted.push([key, value]));
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    expect(evicted).toEqual([["a", 1]]);
  });

  test("setLimit drops the oldest entries and reports each one", () => {
    const evicted: Array<[string, number]> = [];
    const lru = createLru<string, number>(4, (value, key) => evicted.push([key, value]));
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    lru.set("d", 4);

    lru.setLimit(2);

    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
    expect(evicted).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  test("a raised limit leaves entries alone and applies to later inserts", () => {
    const lru = createLru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);

    lru.setLimit(3);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("b")).toBe(2);

    lru.set("c", 3);
    expect(lru.get("c")).toBe(3);

    lru.set("d", 4);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
  });

  test("setLimit(0) clears the cache through the eviction hook", () => {
    const evicted: string[] = [];
    const lru = createLru<string, number>(3, (_value, key) => evicted.push(key));
    lru.set("a", 1);
    lru.set("b", 2);

    lru.setLimit(0);

    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBeUndefined();
    expect(evicted).toEqual(["a", "b"]);

    lru.set("c", 3);
    expect(lru.get("c")).toBeUndefined();
    expect(evicted).toEqual(["a", "b", "c"]);
  });
});
