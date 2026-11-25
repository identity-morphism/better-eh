import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { coreTagData } from "../../src/tags/core";
import { resetTagCounts } from "../../src/tags/counts";
import { getTagIndex, loadTagIndex, resetTagIndex, tagId } from "../../src/tags/db";
import { encodeTagVocabulary } from "../../src/tags/index-codec";

const originalFetch = globalThis.fetch;
const CACHE_KEY = "eh:tag-index:v2";
const COUNTS_KEY = "eh:tag-counts:v3";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  GM_setValue(CACHE_KEY, null);
  GM_setValue(COUNTS_KEY, null);
  resetTagIndex();
  resetTagCounts();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("core tag vocabulary", () => {
  test("embeds a usable slice of every namespace", () => {
    const data = coreTagData();

    expect(data).not.toBeNull();
    if (!data) {
      throw new Error("expected the embedded vocabulary to decode");
    }
    const groups = data.groups;
    expect(groups.size).toBe(12);
    const total = [...groups.values()].reduce((sum, keys) => sum + keys.length, 0);
    expect(total).toBeGreaterThan(1000);
    for (const keys of groups.values()) {
      expect(keys.length).toBeLessThanOrEqual(200);
    }
    expect(groups.get("language")).toContain("english");
    expect(groups.get("female")).toContain("big breasts");
    expect(data.counts?.max).toBeGreaterThan(1_000_000);
    expect(data.counts?.counts.size).toBeGreaterThan(800);
  });

  test("serves the core with empty storage without touching the network", () => {
    let requests = 0;
    globalThis.fetch = (() => {
      requests++;
      return Promise.reject(new Error("offline"));
    }) as unknown as typeof fetch;

    const index = getTagIndex();

    expect(requests).toBe(0);
    expect(index?.updated).toBe(0);
    expect(index?.lookup.get(tagId("language", "english"))).toBeDefined();
    expect(index?.lookup.get(tagId("female", "big breasts"))).toBeDefined();
    // First-run suggestions rank with the same popularity the core was selected by.
    expect(index?.maxCount).toBeGreaterThan(1_000_000);
    expect(index?.lookup.get(tagId("language", "english"))?.count).toBeGreaterThan(0);
  });

  test("loads the core while the full download is still pending", async () => {
    const pending = Promise.withResolvers<Response>();
    let indexRequests = 0;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (!requestUrl(input).includes("tag-index.bin")) {
        return Promise.reject(new Error("counts unavailable"));
      }
      indexRequests++;
      return pending.promise;
    }) as typeof fetch;

    const index = await loadTagIndex(false);

    expect(indexRequests).toBe(1);
    expect(index.updated).toBe(0);
    expect(index.lookup.get(tagId("language", "english"))).toBeDefined();

    pending.reject(new Error("offline"));
    await pending.promise.catch(() => {});
  });

  test("loads the core when the full download fails", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

    const index = await loadTagIndex(false);

    expect(index.updated).toBe(0);
    expect(index.lookup.get(tagId("language", "english"))).toBeDefined();
  });

  test("a successful download replaces the core and survives a reset", async () => {
    const bytes = encodeTagVocabulary(new Map([["female", ["downloaded tag"]]]));
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (requestUrl(input).includes("tag-index.bin")) {
        return Promise.resolve(new Response(new Blob([bytes.slice()])));
      }
      return Promise.reject(new Error("counts unavailable"));
    }) as typeof fetch;

    const downloaded = await loadTagIndex(true);
    expect(downloaded.lookup.get(tagId("female", "downloaded tag"))).toBeDefined();

    const current = getTagIndex();
    expect(current?.lookup.get(tagId("female", "downloaded tag"))).toBeDefined();
    expect(current?.lookup.get(tagId("language", "english"))).toBeUndefined();

    // Resetting forgets the cached full index, but the embedded core stays available.
    GM_setValue(CACHE_KEY, null);
    resetTagIndex();
    const fallback = getTagIndex();
    expect(fallback?.lookup.get(tagId("language", "english"))).toBeDefined();
    expect(fallback?.lookup.get(tagId("female", "downloaded tag"))).toBeUndefined();
  });
});
