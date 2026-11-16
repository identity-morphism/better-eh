import { describe, expect, test } from "bun:test";

import type { TagCompletion, TagIndex, TagUsage } from "../../src/tags/db";
import { buildTagIndex, COMPLETION_TTL_MS, completionId, tagId } from "../../src/tags/db";
import { parseSearchTerms } from "../../src/tags/model";
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
      { namespace: "male", data: { "big dick": {}, "sole male": {} } },
      { namespace: "artist", data: { "big boobs artist": {} } },
      { namespace: "parody", data: { 86: {}, "resident evil": {} } },
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
      { namespace: "parody", data: { 86: {}, "resident evil": {} } },
    ],
  },
  1,
  new Map([
    [tagKeyId("english"), 771_349],
    [tagKeyId("japanese"), 19_655],
    [tagKeyId("chinese"), 366_751],
    [tagKeyId("translated"), 860_429],
    [tagKeyId("enema"), 16_348],
    [tagKeyId("big breasts"), 1_324_855],
    [tagKeyId("en"), 122],
    [tagKeyId("trans"), 30],
    [tagKeyId("ai generated"), 550_577],
    [tagKeyId("86"), 609],
    [tagKeyId("3d"), 242_537],
    [tagKeyId("3d imageset"), 26_307],
    [tagKeyId("replaced"), 54_047],
    [tagKeyId("resident evil"), 13_242],
  ]),
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

function tagKeys(result: ReturnType<typeof suggest>): string[] {
  return result.items.flatMap((item) => (item.kind === "tag" ? [item.entry.key] : []));
}

describe("suggestions", () => {
  test("puts an exact tag first", () => {
    const result = suggest("86");

    expect(result.items[0]?.kind).toBe("tag");
    expect(result.items[0]?.kind === "tag" && result.items[0].entry.key).toBe("86");
    expect(result.total).toBe(1);
  });

  test("completes multi-word tags from unquoted input", () => {
    const result = suggest("big b");

    expect(tagKeys(result).sort()).toEqual(["big boobs artist", "big breasts", "big brother"]);
    expect(result.term.value).toBe("big b");
    expect(result.term.start).toBe(0);
    expect(result.term.end).toBe(5);
  });

  test("merges only the words that end at the caret", () => {
    const result = suggest("cat big b");

    expect(result.term.value).toBe("big b");
    expect(result.term.start).toBe(4);
    expect(result.term.end).toBe(9);
    expect(tagKeys(result).sort()).toEqual(["big boobs artist", "big breasts", "big brother"]);
  });

  test("inherits a leading namespace and sign in a merged phrase", () => {
    const female = suggest("female:big b");
    expect(female.term.ns?.id).toBe("female");
    expect(female.term.start).toBe(0);
    expect(tagKeys(female).sort()).toEqual(["big breasts", "big brother"]);

    const excluded = suggest("-big b");
    expect(excluded.term.sign).toBe("-");
    expect(tagKeys(excluded).sort()).toEqual(["big boobs artist", "big breasts", "big brother"]);
  });

  test("detects tags applied outside a merged phrase", () => {
    const result = suggest('female:"big breasts$" big b');
    const applied = result.items.find(
      (item) => item.kind === "tag" && item.entry.key === "big breasts",
    );

    expect(applied?.kind).toBe("tag");
    if (applied?.kind === "tag") {
      expect(applied.applied?.raw).toBe('female:"big breasts$"');
    }
  });

  test("matches applied tags across aliases and key spelling", () => {
    const result = suggest('f:"Big_Breasts$" female:big');
    const applied = result.items.find(
      (item) => item.kind === "tag" && item.entry.key === "big breasts",
    );

    expect(applied?.kind).toBe("tag");
    if (applied?.kind === "tag") {
      expect(applied.applied?.raw).toBe('f:"Big_Breasts$"');
    }
  });

  test("ranks prefixes and reports every match", () => {
    const result = suggest("big");

    expect(tagKeys(result).sort()).toEqual([
      "big boobs artist",
      "big breasts",
      "big brother",
      "big dick",
    ]);
    expect(result.total).toBe(4);
    expect(result.empty).toBe(false);
  });

  test("prefers a prefix over a substring", () => {
    const result = suggest("breasts");
    const keys = tagKeys(result);

    expect(keys.slice(0, 2)).toEqual(["big breasts", "small breasts"]);
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

  test("marks tags already present elsewhere in the query", () => {
    const result = suggest('female:"big breasts$" female:big');
    const applied = result.items.find(
      (item) => item.kind === "tag" && item.entry.key === "big breasts",
    );

    expect(applied?.kind).toBe("tag");
    if (applied?.kind === "tag") {
      expect(applied.applied?.raw).toBe('female:"big breasts$"');
    }
  });

  test("does not mark the active term as applied", () => {
    const result = suggest("female:big");
    expect(result.items.every((item) => item.kind === "tag" && item.applied === null)).toBe(true);
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

  test("lists a namespace's tags when only the prefix is typed", () => {
    const result = suggest("female:");

    expect(tagKeys(result).sort()).toEqual([
      "big breasts",
      "big brother",
      "small breasts",
      "sole female",
    ]);
    expect(result.empty).toBe(true);
  });

  test("returns nothing for an unknown namespace", () => {
    const result = suggest("zz:foo");

    expect(result.items).toHaveLength(0);
    expect(result.empty).toBe(false);
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
    test("surfaces a common language tag over exact short tags", () => {
      const keys = tagKeys(popularSuggest("en"));
      const first = popularSuggest("en").items[0];

      expect(first?.kind).toBe("tag");
      if (first?.kind === "tag") {
        expect(first.entry.ns.id).toBe("language");
        expect(first.entry.key).toBe("english");
      }
      expect(keys.indexOf("english")).toBeLessThan(keys.indexOf("enema"));
      expect(keys.indexOf("english")).toBeLessThan(keys.indexOf("en"));
    });

    test("ranks japanese, chinese and translated above their competitors", () => {
      expect(tagKeys(popularSuggest("ja"))[0]).toBe("japanese");
      expect(tagKeys(popularSuggest("ch"))[0]).toBe("chinese");
      expect(tagKeys(popularSuggest("trans"))[0]).toBe("translated");
    });

    test("prefers a popular multi-word tag", () => {
      expect(tagKeys(popularSuggest("big b"))[0]).toBe("big breasts");
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

    test("handles prototype-named queries safely", () => {
      for (const query of ["constructor", "__proto__"]) {
        const result = popularSuggest(query);
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      }
    });

    test("orders a namespace's empty list by popularity", () => {
      const result = buildSuggestions(POPULAR, "language:", "language:".length, new Map(), 50);

      expect(tagKeys(result).slice(0, 4)).toEqual(["translated", "english", "chinese", "japanese"]);
    });
  });

  test("a remembered pick overrides the popularity prior for its prefix", () => {
    const plain = popularSuggest("en");
    expect(tagKeys(plain)[0]).toBe("english");

    const completions = new Map([completion("en", "enema", Date.now())]);
    const remembered = popularSuggest("en", completions);
    expect(tagKeys(remembered)[0]).toBe("enema");
  });

  test("completion memory is prefix-specific", () => {
    const now = Date.now();
    const plain = tagKeys(popularSuggest("en"));
    const unrelated = new Map([completion("ene", "enema", now)]);
    const matching = new Map([completion("en", "enema", now)]);

    expect(plain[0]).not.toBe("enema");
    expect(tagKeys(popularSuggest("en", unrelated))[0]).toBe(plain[0]);
    expect(tagKeys(popularSuggest("en", matching))[0]).toBe("enema");
  });

  test("a remembered pick decays and expires", () => {
    const now = Date.now();
    const scoreAt = (lastUsed: number): number => {
      const result = popularSuggest("en", new Map([completion("en", "enema", lastUsed)]));
      return (
        result.items.find((item) => item.kind === "tag" && item.entry.key === "enema")?.score ?? 0
      );
    };

    const fresh = scoreAt(now);
    const month = scoreAt(now - 30 * 24 * 60 * 60 * 1000);
    const expired = scoreAt(now - COMPLETION_TTL_MS - 1);
    const none = scoreAt(0);

    expect(month).toBeLessThan(fresh);
    expect(expired).toBe(none);
  });

  test("namespace-scoped picks stay in their namespace", () => {
    const completions = new Map([completion("en", "enema", Date.now(), 1, "male", "male")]);
    const scoped = buildSuggestions(
      POPULAR,
      "male:en",
      "male:en".length,
      new Map(),
      50,
      completions,
    );
    const unscoped = buildSuggestions(POPULAR, "en", 2, new Map(), 50, completions);

    const enemaScore = (result: ReturnType<typeof buildSuggestions>): number =>
      result.items.find((item) => item.kind === "tag" && item.entry.key === "enema")?.score ?? 0;

    expect(enemaScore(scoped)).toBeGreaterThan(enemaScore(unscoped));
  });
});
