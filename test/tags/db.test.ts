import { describe, expect, test } from "bun:test";

import { base64FromBytes } from "../../src/tags/base64";
import { resetTagCounts } from "../../src/tags/counts";
import { buildTagIndex, getTagIndex, resetTagIndex, tagId } from "../../src/tags/db";
import { encodeTagCountsBytes, tagKeyId } from "../../src/tags/tag-counts-codec";

const CACHE_KEY = "eh:tag-index:v2";
const COUNTS_KEY = "eh:tag-counts:v3";

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
  test("builds namespaces, normalizes keys, drops metadata and attaches popularity", () => {
    const counts = new Map([
      [tagKeyId("big breasts"), 500],
      [tagKeyId("big brother"), 25],
    ]);
    const index = buildTagIndex(RAW, 1234, { counts, max: 500 });

    expect(index.updated).toBe(1234);
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
});
