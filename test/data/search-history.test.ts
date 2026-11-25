import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearRecentQueries,
  RECENT_LIMIT,
  RECENT_TTL_MS,
  recentQueries,
  rememberQuery,
} from "../../src/data/search-history";

beforeEach(() => {
  GM_setValue("eh:search-history:v1", []);
});

describe("recent searches", () => {
  test("normalizes, deduplicates and moves repeats to the front", () => {
    rememberQuery("  Big   Breasts ");
    rememberQuery("   ");
    rememberQuery("english");
    rememberQuery("big breasts");

    expect(recentQueries().map((entry) => entry.text)).toEqual(["big breasts", "english"]);
  });

  test("caps the list, expires old entries and clears on request", () => {
    const now = 1_000_000_000_000;
    for (let index = 0; index < RECENT_LIMIT + 5; index++) {
      rememberQuery(`query ${index}`, now + index);
    }
    expect(recentQueries(now)).toHaveLength(RECENT_LIMIT);
    expect(recentQueries(now)[0]?.text).toBe(`query ${RECENT_LIMIT + 4}`);

    rememberQuery("old", now);
    expect(recentQueries(now + RECENT_TTL_MS - 1)).toContainEqual({ text: "old", usedAt: now });
    expect(recentQueries(now + RECENT_TTL_MS).map((entry) => entry.text)).not.toContain("old");

    clearRecentQueries();
    expect(recentQueries(now)).toEqual([]);
  });
});
