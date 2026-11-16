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
  test("deduplicates by case and whitespace and moves repeats to the front", () => {
    rememberQuery("  Big   Breasts ");
    rememberQuery("english");
    rememberQuery("big breasts");

    expect(recentQueries().map((entry) => entry.text)).toEqual(["big breasts", "english"]);
  });

  test("ignores empty queries and caps the list", () => {
    rememberQuery("   ");
    expect(recentQueries()).toEqual([]);

    const now = Date.now();
    for (let index = 0; index < RECENT_LIMIT + 5; index++) {
      rememberQuery(`query ${index}`, now + index);
    }
    expect(recentQueries(now)).toHaveLength(RECENT_LIMIT);
    expect(recentQueries(now)[0]?.text).toBe(`query ${RECENT_LIMIT + 4}`);
  });

  test("expires old entries and clears on request", () => {
    const now = 1_000_000_000_000;
    rememberQuery("old", now);
    expect(recentQueries(now + RECENT_TTL_MS - 1)).toHaveLength(1);
    expect(recentQueries(now + RECENT_TTL_MS)).toEqual([]);

    rememberQuery("fresh", now);
    clearRecentQueries();
    expect(recentQueries(now)).toEqual([]);
  });
});
