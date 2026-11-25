import { beforeEach, describe, expect, test } from "bun:test";

import {
  QUICK_TAG_LIMIT,
  quickTags,
  removeQuickTag,
  replaceQuickTags,
} from "../../src/data/quick-tags";
const KEY = "eh:saved-expressions:v1";

beforeEach(() => {
  GM_setValue(KEY, []);
});

describe("quick tags", () => {
  test("replaces the whole list, normalizing rows and dropping blanks", () => {
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

    replaceQuickTags(
      Array.from({ length: QUICK_TAG_LIMIT + 5 }, (_, index) => ({
        name: `n${index}`,
        query: `q${index}`,
        savedAt: index,
      })),
    );
    expect(quickTags()).toHaveLength(QUICK_TAG_LIMIT);
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

  test("treats corrupt storage as empty", () => {
    GM_setValue(KEY, "not a list");
    expect(quickTags()).toEqual([]);

    GM_setValue(KEY, { version: 99, values: [{ name: "A", query: "a" }] });
    expect(quickTags()).toEqual([]);
  });
});
