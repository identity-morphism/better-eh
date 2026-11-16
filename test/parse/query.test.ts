import { describe, expect, test } from "bun:test";

import type { SearchQuery } from "../../src/parse/query";
import {
  buildSearchUrl,
  parseSearchQuery,
  tagTokenFromHref,
  uploaderTokenFromHref,
} from "../../src/parse/query";

const BASE = "https://e-hentai.org/";

const EMPTY: SearchQuery = {
  text: "",
  cats: 0,
  rating: 0,
  expunged: false,
  torrent: false,
  pageFrom: "",
  pageTo: "",
  disableLanguage: false,
  disableUploader: false,
  disableTags: false,
};

describe("search query serialization", () => {
  test("round-trips an advanced search through buildSearchUrl", () => {
    const query: SearchQuery = {
      text: "foo bar",
      cats: 4,
      rating: 3,
      expunged: true,
      torrent: false,
      pageFrom: "1",
      pageTo: "10",
      disableLanguage: true,
      disableUploader: false,
      disableTags: true,
    };

    const built = buildSearchUrl(query);
    expect(built).toBe(
      "/?f_search=foo+bar&f_cats=4&f_srdd=3&f_sh=on&f_spf=1&f_spt=10&f_sfl=on&f_sft=on&advsearch=1",
    );
    expect(parseSearchQuery(new URL(built, BASE))).toEqual(query);
  });

  test("round-trips a parsed URL that already carries advsearch=1", () => {
    const parsed = parseSearchQuery(
      new URL("https://e-hentai.org/?f_search=dogs&f_srdd=2&advsearch=1"),
    );

    expect(buildSearchUrl(parsed)).toBe("/?f_search=dogs&f_srdd=2&advsearch=1");
  });

  test("builds a bare URL when every field is empty", () => {
    expect(buildSearchUrl(EMPTY)).toBe("/");
    expect(parseSearchQuery(new URL("/", BASE))).toEqual(EMPTY);
  });

  test("trims search text and omits advsearch for plain searches", () => {
    expect(buildSearchUrl({ ...EMPTY, text: "  cat  " })).toBe("/?f_search=cat");
  });

  test("adds advsearch when an advanced switch is set", () => {
    expect(buildSearchUrl({ ...EMPTY, torrent: true })).toBe("/?f_sto=on&advsearch=1");
  });
});

describe("tag links", () => {
  test("quotes multi-word tag values for exact matching", () => {
    expect(tagTokenFromHref("/tag/artist:foo+bar", BASE)).toBe('a:"foo bar$"');
    expect(tagTokenFromHref("/tag/artist:foo%20bar", BASE)).toBe('a:"foo bar$"');
  });

  test("prefers short namespace aliases and keeps unknown ones", () => {
    expect(tagTokenFromHref("/tag/artist:foo", BASE)).toBe("a:foo$");
    expect(tagTokenFromHref("https://e-hentai.org/tag/reclass:series+one", BASE)).toBe(
      'r:"series one$"',
    );
    expect(tagTokenFromHref("/tag/female:big+brevity", BASE)).toBe('f:"big brevity$"');
    expect(tagTokenFromHref("/tag/anime:foo", BASE)).toBe("anime:foo$");
  });

  test("ignores anchors outside /tag/", () => {
    expect(tagTokenFromHref("/g/1/abc/", BASE)).toBeNull();
  });

  test("drops a malformed percent escape instead of throwing", () => {
    expect(tagTokenFromHref("/tag/female:%ZZ", BASE)).toBeNull();
    expect(tagTokenFromHref("/tag/female:%", BASE)).toBeNull();
  });
});

describe("uploader links", () => {
  test("turns an uploader page into its search token", () => {
    expect(uploaderTokenFromHref("/uploader/lasthm", BASE)).toBe("uploader:lasthm$");
    expect(uploaderTokenFromHref("https://e-hentai.org/uploader/lasthm/", BASE)).toBe(
      "uploader:lasthm$",
    );
  });

  test("quotes multi-word uploader names", () => {
    expect(uploaderTokenFromHref("/uploader/Zero+Angel", BASE)).toBe('uploader:"Zero Angel$"');
    expect(uploaderTokenFromHref("/uploader/Zero%20Angel", BASE)).toBe('uploader:"Zero Angel$"');
  });

  test("rejects paths that are not one uploader", () => {
    expect(uploaderTokenFromHref("/uploader/", BASE)).toBeNull();
    expect(uploaderTokenFromHref("/uploader/a/b", BASE)).toBeNull();
    expect(uploaderTokenFromHref("/tag/artist:foo", BASE)).toBeNull();
    expect(uploaderTokenFromHref("/uploader/%", BASE)).toBeNull();
  });
});
