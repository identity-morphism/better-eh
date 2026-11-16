import { afterEach, describe, expect, test } from "bun:test";

import { base64FromBytes } from "../../src/tags/base64";
import { resetTagCounts } from "../../src/tags/counts";
import { buildTagIndex, getTagIndex, loadTagIndex, resetTagIndex, tagId } from "../../src/tags/db";
import { encodeTagVocabulary } from "../../src/tags/index-codec";
import { encodeTagCountsBytes, tagKeyId } from "../../src/tags/tag-counts-codec";

const originalFetch = globalThis.fetch;
const CACHE_KEY = "eh:tag-index:v2";
const COUNTS_KEY = "eh:tag-counts:v3";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const RAW = {
  data: [
    { namespace: "rows", data: { female: { name: "<p>female</p>" } } },
    {
      namespace: "female",
      data: {
        Big_Breasts: {},
        "big breasts": {},
        "big brother": {},
        "sole female": {},
        "small breasts": {},
      },
    },
    { namespace: "male", data: { "big dick": {}, "sole male": {} } },
    { namespace: "artist", data: { 2: {}, foo: {} } },
    { namespace: "parody", data: { 86: {} } },
    { namespace: "unknown", data: { ignored: {} } },
    { namespace: "group", data: null },
  ],
};

describe("tag index", () => {
  test("builds namespaces, normalizes keys, and drops metadata", () => {
    const index = buildTagIndex(RAW, 1234);

    expect(index.updated).toBe(1234);
    expect(index.entries).toHaveLength(9);
    expect(index.byNamespace.get("female")?.map((entry) => entry.key)).toEqual([
      "big breasts",
      "big brother",
      "small breasts",
      "sole female",
    ]);
    expect(index.byNamespace.get("artist")?.map((entry) => entry.key)).toEqual(["2", "foo"]);
    expect(index.byNamespace.has("rows")).toBe(false);
    expect(index.byNamespace.has("unknown")).toBe(false);
    expect(index.lookup.get(tagId("female", "big breasts"))?.folded).toBe("big breasts");
  });

  test("attaches popularity counts while building", () => {
    const counts = new Map([
      [tagKeyId("big breasts"), 500],
      [tagKeyId("big brother"), 25],
    ]);
    const index = buildTagIndex(RAW, 1, counts);

    expect(index.maxCount).toBe(500);
    expect(index.lookup.get(tagId("female", "big breasts"))?.count).toBe(500);
    expect(index.lookup.get(tagId("female", "big brother"))?.count).toBe(25);
    expect(index.lookup.get(tagId("female", "sole female"))?.count).toBe(0);
  });

  test("reads the stored index and applies the cached popularity", () => {
    resetTagIndex();
    resetTagCounts();
    GM_setValue(CACHE_KEY, {
      version: 2,
      values: {
        updated: 55,
        payload: { female: ["Big_Breasts", "big brother"] },
      },
    });
    GM_setValue(COUNTS_KEY, {
      version: 3,
      values: {
        updated: 1,
        payload: base64FromBytes(encodeTagCountsBytes(new Map([["big breasts", 500]]))),
      },
    });

    const index = getTagIndex();

    expect(index?.updated).toBe(55);
    expect(index?.byNamespace.get("female")?.map((entry) => entry.key)).toEqual([
      "big breasts",
      "big brother",
    ]);
    expect(index?.maxCount).toBe(500);
    expect(index?.lookup.get(tagId("female", "big breasts"))?.count).toBe(500);
  });

  test("rejects malformed and empty payloads", () => {
    expect(() => buildTagIndex(null)).toThrow();
    expect(() => buildTagIndex({ data: "nope" })).toThrow();
    expect(() => buildTagIndex({ data: [] })).toThrow();
  });

  test("a forced retry supersedes an in-flight download", async () => {
    GM_setValue(CACHE_KEY, null);

    const firstBytes = encodeTagVocabulary(new Map([["female", ["first tag"]]]));
    const secondBytes = encodeTagVocabulary(new Map([["female", ["second tag"]]]));
    const firstResponse = Promise.withResolvers<Response>();
    let indexRequests = 0;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("tag-index.bin")) {
        return Promise.reject(new Error("counts unavailable"));
      }
      indexRequests++;
      return indexRequests === 1
        ? firstResponse.promise
        : Promise.resolve(new Response(new Blob([secondBytes.slice()])));
    }) as typeof fetch;

    const firstLoad = loadTagIndex(true);
    const second = await loadTagIndex(true);

    expect(indexRequests).toBe(2);
    expect(second.lookup.get(tagId("female", "second tag"))).toBeDefined();
    expect(second.lookup.get(tagId("female", "first tag"))).toBeUndefined();

    // The superseded download still resolves, but must not replace the newer index.
    firstResponse.resolve(new Response(new Blob([firstBytes.slice()])));
    await firstLoad;

    const current = getTagIndex();
    expect(current?.lookup.get(tagId("female", "second tag"))).toBeDefined();
    expect(current?.lookup.get(tagId("female", "first tag"))).toBeUndefined();
  });
});
