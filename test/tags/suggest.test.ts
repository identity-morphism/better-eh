import { describe, expect, test } from "bun:test";

import type { TagCompletion, TagIndex, TagUsage } from "../../src/tags/db";
import { buildTagIndex, COMPLETION_TTL_MS, completionId, tagId } from "../../src/tags/db";
import { parseSearchTerms } from "../../src/tags/model";
import type { SuggestResult } from "../../src/tags/suggest";
import { buildSuggestions, effectiveSign, suggestionInsertion } from "../../src/tags/suggest";
import { tagKeyId } from "../../src/tags/tag-counts-codec";

const INDEX: TagIndex = buildTagIndex(
  {
    data: [
      {
        namespace: "female",
        data: {
          "big breasts": {},
          "big brother": {},
          "sole female": {},
          "small breasts": {},
        },
      },
      { namespace: "male", data: { "big dick": {} } },
      { namespace: "artist", data: { "big boobs artist": {} } },
    ],
  },
  1,
);

/**
 * Popularity fixture: numbers are shaped like the live dataset so rank changes are realistic
 * without depending on a network download.
 */
const POPULAR: TagIndex = buildTagIndex(
  {
    data: [
      {
        namespace: "language",
        data: { chinese: {}, english: {}, japanese: {}, translated: {} },
      },
      {
        namespace: "female",
        data: { "big breasts": {}, enema: {} },
      },
      { namespace: "male", data: { "big breasts": {}, enema: {} } },
      { namespace: "artist", data: { en: {} } },
      { namespace: "group", data: { en: {}, trans: {} } },
      {
        namespace: "other",
        data: { "3d": {}, "3d imageset": {}, "ai generated": {}, replaced: {} },
      },
      { namespace: "parody", data: { "resident evil": {} } },
    ],
  },
  1,
  {
    counts: new Map([
      [tagKeyId("english"), 771_349],
      [tagKeyId("japanese"), 19_655],
      [tagKeyId("chinese"), 366_751],
      [tagKeyId("translated"), 860_429],
      [tagKeyId("enema"), 16_348],
      [tagKeyId("big breasts"), 1_324_855],
      [tagKeyId("en"), 122],
      [tagKeyId("trans"), 30],
      [tagKeyId("ai generated"), 550_577],
      [tagKeyId("3d"), 242_537],
      [tagKeyId("3d imageset"), 26_307],
      [tagKeyId("replaced"), 54_047],
      [tagKeyId("resident evil"), 13_242],
    ]),
    max: 1_324_855,
  },
);

function usageOf(entries: Array<[string, string, number]>): Map<string, TagUsage> {
  return new Map(
    entries.map(([ns, key, count]) => [tagId(ns, key), { count, lastUsed: Date.now() }]),
  );
}

function suggest(text: string, usage: ReadonlyMap<string, TagUsage> = new Map()) {
  return buildSuggestions(INDEX, text, text.length, usage, 50);
}

function popularSuggest(text: string, completions: ReadonlyMap<string, TagCompletion> = new Map()) {
  return buildSuggestions(POPULAR, text, text.length, new Map(), 50, completions);
}

function completion(
  prefix: string,
  key: string,
  lastUsed: number,
  count = 1,
  prefixNs = "",
  ns = "female",
): [string, TagCompletion] {
  return [completionId({ prefixNs, prefix, ns, key }), { count, lastUsed }];
}

function tagKeys(result: SuggestResult): string[] {
  return result.items.flatMap((item) => (item.kind === "tag" ? [item.entry.key] : []));
}

describe("suggestions", () => {
  test("merges multi-word phrases that end at the caret, inheriting namespace and sign", () => {
    const merged = suggest("cat big b");
    expect(merged.term.value).toBe("big b");
    expect(merged.term.start).toBe(4);
    expect(merged.term.end).toBe(9);
    expect(tagKeys(merged).sort()).toEqual(["big boobs artist", "big breasts", "big brother"]);

    const female = suggest("female:big b");
    expect(female.term.ns?.id).toBe("female");
    expect(female.term.start).toBe(0);
    expect(tagKeys(female).sort()).toEqual(["big breasts", "big brother"]);

    const excluded = suggest("-big b");
    expect(excluded.term.sign).toBe("-");
    expect(tagKeys(excluded).sort()).toEqual(["big boobs artist", "big breasts", "big brother"]);
  });

  test("marks tags applied elsewhere, matching aliases and key spelling", () => {
    const result = suggest('f:"Big_Breasts$" female:big');
    const applied = result.items.find(
      (item) => item.kind === "tag" && item.entry.key === "big breasts",
    );

    expect(applied?.kind).toBe("tag");
    if (applied?.kind === "tag") {
      expect(applied.applied?.raw).toBe('f:"Big_Breasts$"');
    }

    // An applied quoted tag must not be pulled into the merged phrase being typed.
    const afterQuote = suggest('female:"big breasts$" big b');
    const later = afterQuote.items.find(
      (item) => item.kind === "tag" && item.entry.key === "big breasts",
    );
    expect(later?.kind === "tag" ? later.applied?.raw : null).toBe('female:"big breasts$"');

    // The term being edited is not itself "already applied".
    const active = suggest("female:big");
    expect(active.items.every((item) => item.kind === "tag" && item.applied === null)).toBe(true);
  });

  test("ranks prefix matches ahead of substrings and reports every match", () => {
    const result = suggest("big");

    expect(tagKeys(result).sort()).toEqual([
      "big boobs artist",
      "big breasts",
      "big brother",
      "big dick",
    ]);
    expect(result.total).toBe(4);
    expect(result.empty).toBe(false);

    const breasts = suggest("breasts");
    expect(tagKeys(breasts).slice(0, 2)).toEqual(["big breasts", "small breasts"]);
  });

  test("filters tags by a namespace", () => {
    const result = suggest("female:big");

    expect(tagKeys(result).sort()).toEqual(["big breasts", "big brother"]);
    expect(result.items.every((item) => item.kind === "tag" && item.entry.ns.id === "female")).toBe(
      true,
    );
  });

  test("completes namespaces, keeping any typed value", () => {
    const result = suggest("fem");
    const first = result.items[0];

    expect(first?.kind).toBe("namespace");
    if (first?.kind === "namespace") {
      expect(first.ns.id).toBe("female");
      expect(suggestionInsertion(first, "")).toBe("f:");
    }

    const partial = suggest("fem:big");
    const namespace = partial.items[0];
    expect(namespace?.kind).toBe("namespace");
    if (namespace?.kind === "namespace") {
      expect(namespace.tail).toBe("big");
      expect(suggestionInsertion(namespace, "-")).toBe("-f:big");
    }
  });

  test("quotes multi-word tags without closing an open quote", () => {
    const result = suggest('female:"big b');
    const first = result.items[0];

    expect(first?.kind).toBe("tag");
    if (first?.kind === "tag") {
      expect(first.entry.key).toBe("big breasts");
      expect(suggestionInsertion(first, "")).toBe('f:"big breasts$"');
    }
  });

  test("shows recents and namespaces for an empty query", () => {
    const result = suggest("", usageOf([["female", "sole female", 3]]));
    const first = result.items[0];

    expect(result.empty).toBe(true);
    expect(first?.kind).toBe("tag");
    if (first?.kind === "tag") {
      expect(first.entry.key).toBe("sole female");
      expect(first.recent).toBe(true);
    }
    expect(result.items.some((item) => item.kind === "namespace")).toBe(true);
  });

  test("boosts tags the user picked before", () => {
    const boosted = suggest("big", usageOf([["female", "big brother", 5]]));
    const first = boosted.items[0];

    expect(first?.kind).toBe("tag");
    if (first?.kind === "tag") {
      expect(first.entry.key).toBe("big brother");
    }
  });

  test("ranks a namespace's tags by popularity when only the prefix is typed", () => {
    const result = buildSuggestions(POPULAR, "language:", "language:".length, new Map(), 50);

    expect(tagKeys(result).slice(0, 4)).toEqual(["translated", "english", "chinese", "japanese"]);
    expect(result.empty).toBe(true);
  });

  test("returns nothing for unknown and prototype-named queries", () => {
    const unknown = suggest("zz:foo");
    expect(unknown.items).toHaveLength(0);
    expect(unknown.empty).toBe(false);

    for (const query of ["constructor", "__proto__"]) {
      const result = popularSuggest(query);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    }
  });

  test("computes the effective sign from the term and the exclusion toggle", () => {
    const excluded = parseSearchTerms("-female:big")[0];
    const included = parseSearchTerms("female:big")[0];
    if (!excluded || !included) {
      throw new Error("expected parsed terms");
    }

    expect(effectiveSign(excluded, false)).toBe("-");
    expect(effectiveSign(included, true)).toBe("-");
    expect(effectiveSign(excluded, true)).toBe("-");
  });

  describe("popularity", () => {
    test("decides between competing prefixes", () => {
      const first = (query: string): string | undefined => tagKeys(popularSuggest(query))[0];

      expect(first("en")).toBe("english");
      expect(first("ja")).toBe("japanese");
      expect(first("ch")).toBe("chinese");
      expect(first("trans")).toBe("translated");
      expect(first("big b")).toBe("big breasts");
    });

    test("does not let a huge substring count dominate a short query", () => {
      const keys = tagKeys(popularSuggest("en"));

      expect(keys.slice(0, 5)).not.toContain("ai generated");
    });

    test("keeps a popular exact short tag first", () => {
      expect(tagKeys(popularSuggest("3d"))[0]).toBe("3d");
    });

    test("does not rank bookkeeping tags by gallery count", () => {
      expect(tagKeys(popularSuggest("re"))[0]).toBe("resident evil");
    });

    test("works from language aliases without popularity data", () => {
      const index = buildTagIndex(
        {
          data: [
            { namespace: "language", data: { english: {} } },
            { namespace: "artist", data: { en: {} } },
            { namespace: "female", data: { enema: {} } },
          ],
        },
        1,
      );
      const result = buildSuggestions(index, "en", 2, new Map(), 50);

      expect(tagKeys(result)[0]).toBe("english");
    });
  });

  test("a remembered pick overrides the popularity prior for its prefix", () => {
    const plain = tagKeys(popularSuggest("en"));
    expect(plain[0]).toBe("english");

    const now = Date.now();
    const matching = popularSuggest("en", new Map([completion("en", "enema", now)]));
    expect(tagKeys(matching)[0]).toBe("enema");

    // The same pick under a different typed prefix changes nothing.
    const unrelated = popularSuggest("en", new Map([completion("ene", "enema", now)]));
    expect(tagKeys(unrelated)[0]).toBe("english");
  });

  test("a remembered pick decays and expires", () => {
    const now = Date.now();
    const scoreAt = (lastUsed: number): number => {
      const result = popularSuggest("en", new Map([completion("en", "enema", lastUsed)]));
      return (
        result.items.find((item) => item.kind === "tag" && item.entry.key === "enema")?.score ?? 0
      );
    };

    expect(scoreAt(now - 30 * 24 * 60 * 60 * 1000)).toBeLessThan(scoreAt(now));

    const expired = popularSuggest(
      "en",
      new Map([completion("en", "enema", now - COMPLETION_TTL_MS - 1)]),
    );
    expect(tagKeys(expired)[0]).toBe("english");
  });

  test("namespace-scoped picks stay in their namespace", () => {
    const completions = new Map([completion("en", "enema", Date.now(), 1, "male", "male")]);
    const enemaScore = (text: string): number => {
      const result = buildSuggestions(POPULAR, text, text.length, new Map(), 50, completions);
      return (
        result.items.find((item) => item.kind === "tag" && item.entry.key === "enema")?.score ?? 0
      );
    };

    expect(enemaScore("male:en")).toBeGreaterThan(enemaScore("en"));
  });
});
