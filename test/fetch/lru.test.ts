import { describe, expect, test } from "bun:test";

import { createLru } from "../../src/fetch/lru";

describe("createLru", () => {
  test("keeps at most the limit, evicting the oldest and never an overwritten entry", () => {
    const lru = createLru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);

    const overwritten = createLru<string, number>(2);
    overwritten.set("a", 1);
    overwritten.set("b", 2);
    overwritten.set("a", 10);

    expect(overwritten.get("a")).toBe(10);
    expect(overwritten.get("b")).toBe(2);
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

  test("reports the evicted entry to the callback", () => {
    const evicted: Array<[string, number]> = [];
    const lru = createLru<string, number>(2, (value, key) => evicted.push([key, value]));
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    expect(evicted).toEqual([["a", 1]]);
  });

  test("setLimit shrinks, grows and applies to later inserts", () => {
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

    lru.setLimit(3);
    lru.set("e", 5);
    lru.set("f", 6);

    expect(lru.get("c")).toBeUndefined();
    expect(lru.get("d")).toBe(4);
    expect(lru.get("e")).toBe(5);
    expect(lru.get("f")).toBe(6);
    expect(evicted).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
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
