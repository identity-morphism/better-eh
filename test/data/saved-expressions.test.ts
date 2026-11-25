import { beforeEach, describe, expect, test } from "bun:test";

import {
  EXPRESSION_LIMIT,
  quickExpressions,
  removeExpression,
  replaceExpressions,
  savedExpressions,
} from "../../src/data/saved-expressions";
import { storedValue } from "../setup";

const KEY = "eh:saved-expressions:v1";

beforeEach(() => {
  GM_setValue(KEY, []);
  GM_setValue("eh:quick-tags:v1", null);
  GM_setValue("eh:saved-searches:v1", null);
});

describe("saved expressions", () => {
  test("migrates legacy quick tags and saved searches once", () => {
    GM_setValue("eh:quick-tags:v1", [{ label: "TAGS", query: "f:keyword$" }]);
    GM_setValue("eh:saved-searches:v1", [{ name: "Artbooks", text: "f:artbook$", savedAt: 5 }]);

    expect(savedExpressions().map((entry) => [entry.name, entry.mode, entry.pinned])).toEqual([
      ["Artbooks", "run", false],
      ["TAGS", "toggle", true],
    ]);
    expect(storedValue("eh:quick-tags:v1")).toBeNull();
    expect(storedValue("eh:saved-searches:v1")).toBeNull();

    removeExpression("TAGS");
    expect(savedExpressions().map((entry) => entry.name)).toEqual(["Artbooks"]);
  });

  test("filters empty fields, normalizes, and removes by name", () => {
    replaceExpressions([
      { name: "", query: "english", mode: "run", pinned: false, savedAt: 1 },
      { name: "Faves", query: "", mode: "run", pinned: false, savedAt: 2 },
      { name: " Faves ", query: " f:doujinshi ", mode: "run", pinned: false, savedAt: 3 },
    ]);
    expect(savedExpressions().map((entry) => [entry.name, entry.query])).toEqual([
      ["Faves", "f:doujinshi"],
    ]);
    expect(savedExpressions()[0]).toMatchObject({ mode: "run", pinned: false });

    removeExpression("FAVES");
    expect(savedExpressions()).toEqual([]);
  });

  test("pinned expressions become toggle quick tags", () => {
    replaceExpressions([
      { name: "Run only", query: "one", mode: "run", pinned: false, savedAt: 1 },
      { name: "Pinned run", query: "two", mode: "run", pinned: true, savedAt: 2 },
    ]);

    expect(quickExpressions().map((entry) => [entry.name, entry.mode])).toEqual([
      ["Pinned run", "toggle"],
    ]);
  });

  test("normalizes an already-stored pinned run expression on read", () => {
    GM_setValue(KEY, [{ name: "Pinned run", query: "two", mode: "run", pinned: true, savedAt: 2 }]);

    expect(savedExpressions()).toMatchObject([{ mode: "toggle", pinned: true }]);
  });

  test("replaces the whole list and caps it", () => {
    replaceExpressions([
      { name: "A", query: "a", mode: "run", pinned: false, savedAt: 1 },
      { name: "", query: "dropped", mode: "run", pinned: false, savedAt: 2 },
    ]);
    expect(savedExpressions().map((entry) => entry.name)).toEqual(["A"]);

    replaceExpressions(
      Array.from({ length: EXPRESSION_LIMIT + 5 }, (_, index) => ({
        name: `n${index}`,
        query: `q${index}`,
        mode: "run" as const,
        pinned: false,
        savedAt: index,
      })),
    );
    expect(savedExpressions()).toHaveLength(EXPRESSION_LIMIT);
  });

  test("treats corrupt storage as empty", () => {
    GM_setValue(KEY, "not a list");
    expect(savedExpressions()).toEqual([]);

    GM_setValue(KEY, { version: 99, values: [{ name: "A", query: "a" }] });
    expect(savedExpressions()).toEqual([]);
  });
});
