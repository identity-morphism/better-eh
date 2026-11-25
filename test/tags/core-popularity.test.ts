import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadTagCounts, resetTagCounts } from "../../src/tags/counts";
import { getTagIndex, onTagIndexChange, resetTagIndex, tagId } from "../../src/tags/db";
import { encodeTagCountsBytes } from "../../src/tags/tag-counts-codec";

const originalFetch = globalThis.fetch;
const COUNTS_KEY = "eh:tag-counts:v3";
const CACHE_KEY = "eh:tag-index:v2";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  GM_setValue(COUNTS_KEY, null);
  GM_setValue(CACHE_KEY, null);
  resetTagCounts();
  resetTagIndex();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("core popularity refresh", () => {
  test("a snapshot downloaded while the core serves ranking attaches to the live index", async () => {
    expect(getTagIndex()).not.toBeNull();

    const bytes = encodeTagCountsBytes(new Map([["english", 900_000]]), 2_000_000);
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (requestUrl(input).includes("tag-counts.bin")) {
        return Promise.resolve(new Response(new Blob([bytes.slice()])));
      }
      return Promise.reject(new Error("unexpected request"));
    }) as typeof fetch;

    let changes = 0;
    const off = onTagIndexChange(() => {
      changes += 1;
    });
    await loadTagCounts(true);
    off();

    const after = getTagIndex();
    expect(changes).toBeGreaterThan(0);
    expect(after?.maxCount).toBe(2_000_000);
    // The quantized 900,000 under the snapshot's 2,000,000 denominator, not the generated core's
    // count and not a recomputed dequantized maximum.
    const english = after?.lookup.get(tagId("language", "english"))?.count ?? 0;
    expect(english).toBeGreaterThan(800_000);
    expect(english).toBeLessThan(1_000_000);
  });
});
