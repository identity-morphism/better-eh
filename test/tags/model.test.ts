import { describe, expect, test } from "bun:test";

import {
  containsExpression,
  formatTagToken,
  parseSearchTerms,
  removeTerm,
  replaceTerm,
  setTermSign,
  tagIdentity,
  termAt,
  termIdentity,
  termLabel,
  termState,
  termStateLabel,
  termTagIdentity,
  toggleExpressionInSearch,
  toggleTagInSearch,
} from "../../src/tags/model";

function onlyTerm(text: string) {
  const term = parseSearchTerms(text)[0];
  if (!term) {
    throw new Error(`expected a term in ${text}`);
  }
  return term;
}

describe("search terms", () => {
  test("parses signs, namespaces, quotes and exact markers", () => {
    const terms = parseSearchTerms('-female:"big brevity$" ~parody:86 cat');

    expect(terms).toHaveLength(3);
    expect(terms[0]).toMatchObject({
      sign: "-",
      nsRaw: "female",
      value: "big brevity",
      quoted: true,
      exact: true,
      raw: '-female:"big brevity$"',
    });
    expect(terms[0]?.ns?.id).toBe("female");
    expect(terms[1]).toMatchObject({ sign: "~", nsRaw: "parody", value: "86", exact: false });
    expect(terms[2]).toMatchObject({ sign: "", nsRaw: null, value: "cat" });
  });

  test("keeps exact markers outside the quote working", () => {
    expect(parseSearchTerms('artist:"foo bar"$')[0]).toMatchObject({
      nsRaw: "artist",
      value: "foo bar",
      exact: true,
    });
    expect(parseSearchTerms("foo$")[0]).toMatchObject({ value: "foo", exact: true });
  });

  test("resolves short namespace aliases and leaves unknown ones unresolved", () => {
    expect(parseSearchTerms("f:big")[0]).toMatchObject({ nsRaw: "f", value: "big" });
    expect(parseSearchTerms("f:big")[0]?.ns?.id).toBe("female");

    expect(parseSearchTerms("anime:foo")[0]).toMatchObject({
      nsRaw: "anime",
      ns: null,
      value: "foo",
    });
  });

  test("parses a lone sign as an empty term", () => {
    expect(parseSearchTerms("-")[0]).toMatchObject({ sign: "-", value: "", raw: "-" });
  });

  test("does not treat colons inside quotes as a namespace", () => {
    expect(parseSearchTerms('"foo:bar"')[0]).toMatchObject({
      nsRaw: null,
      value: "foo:bar",
    });
  });
});

describe("termAt", () => {
  test("finds the term under the caret", () => {
    const text = 'female:"big brevity"';
    expect(termAt(text, 12).value).toBe("big brevity");
    expect(termAt(text, text.length).value).toBe("big brevity");
  });

  test("returns an insertion point between terms", () => {
    expect(termAt("female:big  ", 11)).toMatchObject({ start: 11, end: 11, raw: "" });
    expect(termAt("", 0)).toMatchObject({ start: 0, end: 0, raw: "" });
  });

  test("clamps a caret outside the text to the final term", () => {
    expect(termAt("cat", 99)).toMatchObject({ start: 0, end: 3, value: "cat" });
  });
});

describe("editing a query", () => {
  test("replaces a term and keeps the rest of the query", () => {
    const text = "female:big cats";
    const term = termAt(text, 8);
    expect(replaceTerm(text, term, 'female:"big brevity$"')).toMatchObject({
      text: 'female:"big brevity$" cats',
      caret: 21,
    });
  });

  test("adds a trailing space after a term at the end", () => {
    const edit = replaceTerm("big", termAt("big", 3), "female:big$");
    expect(edit.text).toBe("female:big$ ");
    expect(edit.caret).toBe(12);
  });

  test("keeps the term open for namespace completion", () => {
    expect(replaceTerm("fem", termAt("fem", 3), "female:", true).text).toBe("female:");
  });

  test("inserts at an empty position with separating spaces", () => {
    expect(replaceTerm("foo  bar", termAt("foo  bar", 4), "x$").text).toBe("foo x$ bar");
    expect(replaceTerm("", termAt("", 0), "x$").text).toBe("x$ ");
  });

  test("removes a term and collapses whitespace", () => {
    const text = "one two three";
    expect(removeTerm(text, termAt(text, 5))).toBe("one three");
    expect(removeTerm(text, termAt(text, 1))).toBe("two three");
    expect(removeTerm(text, termAt(text, text.length))).toBe("one two");
  });

  test("rewrites only the sign", () => {
    const text = "-female:big cats";
    expect(setTermSign(text, termAt(text, 1), "~")).toBe("~female:big cats");
    expect(setTermSign("female:big", termAt("female:big", 0), "-")).toBe("-female:big");
  });
});

describe("adding gallery tags to a search", () => {
  const TOKEN = 'artist:"bob smith$"';

  test("appends the tag with a short namespace alias", () => {
    expect(toggleTagInSearch("", TOKEN)).toBe('a:"bob smith$"');
    expect(toggleTagInSearch("cat", TOKEN)).toBe('cat a:"bob smith$"');
  });

  test("toggles an already included tag off", () => {
    expect(toggleTagInSearch(`cat ${TOKEN} dog`, TOKEN)).toBe("cat dog");
  });

  test("switches between inclusion and exclusion", () => {
    expect(toggleTagInSearch(TOKEN, TOKEN, "-")).toBe(`-${TOKEN}`);
    expect(toggleTagInSearch(`-${TOKEN}`, TOKEN)).toBe(TOKEN);
  });

  test("sets an optional tag instead of dropping it", () => {
    expect(toggleTagInSearch(TOKEN, TOKEN, "~")).toBe(`~${TOKEN}`);
    expect(toggleTagInSearch(`-${TOKEN}`, TOKEN, "~")).toBe(`~${TOKEN}`);
    expect(toggleTagInSearch(`~${TOKEN}`, TOKEN, "~")).toBe("");
    expect(toggleTagInSearch(`~${TOKEN}`, TOKEN)).toBe(TOKEN);
  });

  test("matches different quoting and exact markers", () => {
    expect(toggleTagInSearch('artist:"bob smith"', TOKEN)).toBe("");
    expect(toggleTagInSearch('ARTIST:"BOB SMITH$"', TOKEN)).toBe("");
    expect(toggleTagInSearch('a:"Bob_Smith$"', TOKEN)).toBe("");
  });

  test("ignores untagged text but treats an unknown prefix as a tag namespace", () => {
    expect(toggleTagInSearch("cat", "dog")).toBe("cat");
    expect(toggleTagInSearch("cat", "uploader:lasthm$")).toBe("cat uploader:lasthm$");
    expect(toggleTagInSearch("cat uploader:Lasthm", "uploader:lasthm$")).toBe("cat");
  });
});

describe("quick tag expressions", () => {
  const EXPRESSION = '~f:keyword$ ~f:"small brevity$"';

  test("adds every missing term and leaves existing terms alone", () => {
    expect(toggleExpressionInSearch("cat ~f:keyword$", EXPRESSION)).toBe(
      'cat ~f:keyword$ ~f:"small brevity$"',
    );
    expect(toggleExpressionInSearch("", EXPRESSION)).toBe(EXPRESSION);
  });

  test("removes every term when the whole expression is present", () => {
    expect(toggleExpressionInSearch(`cat ${EXPRESSION} dog`, EXPRESSION)).toBe("cat dog");
  });

  test("matches namespaces, quoting, signs and exact markers", () => {
    expect(containsExpression('female:"small brevity"', EXPRESSION)).toBe(false);
    expect(containsExpression('f:keyword f:"small brevity"', EXPRESSION)).toBe(true);
    expect(containsExpression('f:keyword f:"Small_brevity$"', EXPRESSION)).toBe(true);
    expect(containsExpression("cat", "")).toBe(false);
  });
});

describe("tag identity", () => {
  test("ignores case, whitespace, underscores and accents", () => {
    expect(tagIdentity("female", "Big_brevity")).toBe("female\u0000big brevity");
    expect(tagIdentity("female", "  big   brevity ")).toBe("female\u0000big brevity");
    expect(tagIdentity("female", "Pokémon")).toBe("female\u0000pokemon");
  });

  test("canonicalizes namespace aliases and case", () => {
    expect(tagIdentity("f", "big brevity")).toBe(tagIdentity("Female", "big brevity"));
    expect(tagIdentity("artist", "foo")).toBe(tagIdentity("A", "foo"));
    expect(tagIdentity("anime", "foo")).toBe(tagIdentity("Anime", "foo"));
  });
});

describe("term identity", () => {
  const same = [
    ['female:"big brevity$"', 'f:"Big_brevity"'],
    ['f:"big brevity"', 'female:"Big  brevity"'],
    ["artist:foo$", "a:foo"],
    ["uploader:lasthm$", "uploader:Lasthm"],
    ["anime:Pokemon$", "Anime:pokemon"],
    ['-female:"big brevity"', '~f:"big brevity"'],
    ["cat", "CAT$"],
    [" cat ", '"cat"'],
  ] as const;
  const different = [
    ['female:"big brevity"', 'female:"big brother"'],
    ['female:"big brevity"', 'male:"big brevity"'],
    ["uploader:lasthm", "lasthm"],
    ["anime:foo", "foo"],
    ["cat", "dog"],
    ["f:cat", "g:cat"],
  ] as const;

  for (const [left, right] of same) {
    test(`${left} and ${right} name the same term`, () => {
      expect(termIdentity(onlyTerm(left))).toBe(termIdentity(onlyTerm(right)));
    });
  }

  for (const [left, right] of different) {
    test(`${left} and ${right} name different terms`, () => {
      expect(termIdentity(onlyTerm(left))).not.toBe(termIdentity(onlyTerm(right)));
    });
  }

  test("reports tag identity only for namespaced terms", () => {
    expect(termTagIdentity(onlyTerm("uploader:lasthm$"))).toBe("uploader\u0000lasthm");
    expect(termTagIdentity(onlyTerm('female:"big brevity"'))).toBe("female\u0000big brevity");
    expect(termTagIdentity(onlyTerm("cat"))).toBeNull();
  });

  test("presents the three signs from one table", () => {
    expect(termState(onlyTerm("cat"))).toBe("in the search");
    expect(termState(onlyTerm("-cat"))).toBe("excluded from the search");
    expect(termState(onlyTerm("~cat"))).toBe("optional (OR) in the search");
    expect(termStateLabel(onlyTerm("-cat"))).toBe("Excluded from the search");
  });
});

describe("tag tokens", () => {
  test("quotes multi-word tags and always marks them exact", () => {
    expect(formatTagToken("female", "big brevity", "-")).toBe('-f:"big brevity$"');
    expect(formatTagToken("parody", "86", "~")).toBe("~p:86$");
  });

  test("normalizes whitespace in values", () => {
    expect(formatTagToken("artist", "  foo   bar ")).toBe('a:"foo bar$"');
  });

  test("labels resolved, unresolved and plain terms", () => {
    expect(termLabel(onlyTerm('female:"big brevity$"'))).toBe("big brevity");
    expect(termLabel(onlyTerm("-cat"))).toBe("cat");
    expect(termLabel(onlyTerm("anime:foo"))).toBe("anime:foo");
  });
});
