import { beforeEach, describe, expect, test } from "bun:test";

import {
  QUICK_TAG_LIMIT,
  quickTags,
  removeQuickTag,
  replaceQuickTags,
} from "../../src/data/quick-tags";
import { storedValue } from "../setup";

const KEY = "eh:saved-expressions:v1";

beforeEach(() => {
  GM_setValue(KEY, []);
  GM_setValue("eh:quick-tags:v1", null);
  GM_setValue("eh:saved-searches:v1", null);
});

describe("quick tags", () => {
  test("migrates legacy quick tags and saved searches once", () => {
    GM_setValue("eh:quick-tags:v1", [{ label: "TAGS", query: "f:keyword$" }]);
    GM_setValue("eh:saved-searches:v1", [{ name: "Artbooks", text: "f:artbook$", savedAt: 5 }]);

    expect(quickTags().map((entry) => [entry.name, entry.query])).toEqual([
      ["Artbooks", "f:artbook$"],
      ["TAGS", "f:keyword$"],
    ]);
    expect(storedValue("eh:quick-tags:v1")).toBeNull();
    expect(storedValue("eh:saved-searches:v1")).toBeNull();

    removeQuickTag("TAGS");
    expect(quickTags().map((entry) => entry.name)).toEqual(["Artbooks"]);
  });

  test("filters empty fields, normalizes, and removes by name", () => {
    replaceQuickTags([
      { name: "", query: "english", savedAt: 1 },
      { name: "Faves", query: "", savedAt: 2 },
      { name: " Faves ", query: " f:doujinshi ", savedAt: 3 },
    ]);
    expect(quickTags().map((entry) => [entry.name, entry.query])).toEqual([
      ["Faves", "f:doujinshi"],
    ]);

    removeQuickTag("FAVES");
    expect(quickTags()).toEqual([]);
  });

  test("reads old records that still carry mode and pinned", () => {
    GM_setValue(KEY, [
      { name: "Old run", query: "f:artbook$", mode: "run", pinned: false, savedAt: 2 },
      { name: "Old tag", query: "f:keyword$", mode: "toggle", pinned: true, savedAt: 1 },
    ]);

    expect(quickTags()).toEqual([
      { name: "Old run", query: "f:artbook$", savedAt: 2 },
      { name: "Old tag", query: "f:keyword$", savedAt: 1 },
    ]);
  });

  test("replaces the whole list and caps it", () => {
    replaceQuickTags([
      { name: "A", query: "a", savedAt: 1 },
      { name: "", query: "dropped", savedAt: 2 },
    ]);
    expect(quickTags().map((entry) => entry.name)).toEqual(["A"]);

    replaceQuickTags(
      Array.from({ length: QUICK_TAG_LIMIT + 5 }, (_, index) => ({
        name: `n${index}`,
        query: `q${index}`,
        savedAt: index,
      })),
    );
    expect(quickTags()).toHaveLength(QUICK_TAG_LIMIT);
  });

  test("treats corrupt storage as empty", () => {
    GM_setValue(KEY, "not a list");
    expect(quickTags()).toEqual([]);

    GM_setValue(KEY, { version: 99, values: [{ name: "A", query: "a" }] });
    expect(quickTags()).toEqual([]);
  });
});
