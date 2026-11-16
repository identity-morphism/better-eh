import { beforeEach, describe, expect, test } from "bun:test";

import {
  buildTagIndex,
  COMPLETION_TTL_MS,
  completionId,
  recordTagCompletion,
  TAG_COMPLETIONS_KEY,
  tagCompletions,
} from "../../src/tags/db";
import type { TagCompletionInput } from "../../src/tags/db";
import { buildSuggestions } from "../../src/tags/suggest";
import { tagKeyId } from "../../src/tags/tag-counts-codec";

beforeEach(() => {
  GM_setValue(TAG_COMPLETIONS_KEY, {});
});

function input(overrides: Partial<TagCompletionInput> = {}): TagCompletionInput {
  return { prefixNs: "", prefix: "en", ns: "female", key: "enema", ...overrides };
}

describe("tag completion memory", () => {
  test("counts repeated picks and folds the typed prefix", () => {
    recordTagCompletion(input({ prefix: "En" }));
    recordTagCompletion(input({ prefix: "en" }));

    const id = completionId(input());
    expect(tagCompletions().get(id)?.count).toBe(2);
  });

  test("keeps prefixes and namespace scopes independent", () => {
    recordTagCompletion(input());
    recordTagCompletion(input({ prefix: "ene" }));
    recordTagCompletion(input({ prefixNs: "female" }));
    recordTagCompletion(input({ ns: "male" }));

    expect(tagCompletions().size).toBe(4);
  });

  test("ignores an empty prefix", () => {
    recordTagCompletion(input({ prefix: "  " }));
    expect(tagCompletions().size).toBe(0);
  });

  test("drops expired picks on read", () => {
    const now = 1_000 * COMPLETION_TTL_MS;
    const stale = completionId(input({ key: "stale" }));
    const fresh = completionId(input({ key: "fresh" }));
    GM_setValue(TAG_COMPLETIONS_KEY, {
      [stale]: { count: 3, lastUsed: now - COMPLETION_TTL_MS - 1 },
      [fresh]: { count: 1, lastUsed: now - 1000 },
    });

    const completions = tagCompletions(now);
    expect(completions.has(stale)).toBe(false);
    expect(completions.has(fresh)).toBe(true);
  });

  test("drops the oldest picks and keeps the newest", () => {
    const now = 1_000_000;
    for (let index = 0; index < 500; index++) {
      recordTagCompletion(input({ key: `tag-${index}` }), now + index);
    }

    const completions = tagCompletions(now + 600);
    expect(completions.has(completionId(input({ key: "tag-0" })))).toBe(false);
    expect(completions.has(completionId(input({ key: "tag-499" })))).toBe(true);
  });

  test("a recorded pick outranks the popularity prior next time", () => {
    const index = buildTagIndex(
      { data: [{ namespace: "female", data: { enema: {}, english: {} } }] },
      1,
      new Map([
        [tagKeyId("enema"), 100],
        [tagKeyId("english"), 100_000],
      ]),
    );
    const firstKey = (): string | undefined => {
      const result = buildSuggestions(index, "en", 2, new Map(), 50, tagCompletions());
      const item = result.items[0];
      return item?.kind === "tag" ? item.entry.key : undefined;
    };

    expect(firstKey()).toBe("english");
    recordTagCompletion(input());
    expect(firstKey()).toBe("enema");
  });
});
