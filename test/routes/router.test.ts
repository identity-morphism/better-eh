import { beforeEach, describe, expect, test } from "bun:test";

import { parseRoute } from "../../src/router";

const ORIGIN = "https://e-hentai.org";

/** `parseRoute` reads the page URL through the global `location`; Bun has none. */
function installLocation(origin: string): void {
  Object.defineProperty(globalThis, "location", {
    value: { href: `${origin}/`, origin },
    configurable: true,
    writable: true,
  });
}

describe("parseRoute", () => {
  beforeEach(() => {
    installLocation(ORIGIN);
  });

  test("keeps the front page and category paths in the search scope", () => {
    for (const path of ["/", "/doujinshi", "/misc", "/tag/language:chinese"]) {
      const route = parseRoute(`${ORIGIN}${path}`);
      expect(route.kind).toBe("list");
      if (route.kind === "list") {
        expect(route.scope).toBe("search");
      }
    }
  });

  test("folds a category path into the query's category mask", () => {
    const doujinshi = parseRoute(`${ORIGIN}/doujinshi`);
    const front = parseRoute(`${ORIGIN}/`);

    expect(doujinshi.kind).toBe("list");
    expect(front.kind).toBe("list");
    if (doujinshi.kind === "list" && front.kind === "list") {
      // All bits set except Doujinshi: the same set the site's `f_cats` filter describes.
      expect(doujinshi.query.cats).toBe(1021);
      expect(front.query.cats).toBe(0);
    }
  });

  test("routes the site's own listing tabs as scoped lists", () => {
    const popular = parseRoute(`${ORIGIN}/popular`);
    const watched = parseRoute(`${ORIGIN}/watched`);

    expect(popular.kind).toBe("list");
    expect(watched.kind).toBe("list");
    if (popular.kind === "list" && watched.kind === "list") {
      expect(popular.scope).toBe("popular");
      expect(watched.scope).toBe("watched");
    }
  });

  test("keeps query text on a scoped list", () => {
    const route = parseRoute(`${ORIGIN}/popular?f_search=test`);

    expect(route.kind).toBe("list");
    if (route.kind === "list") {
      expect(route.scope).toBe("popular");
      expect(route.query.text).toBe("test");
    }
  });

  test("routes uploader pages through the list with the uploader's search token", () => {
    const route = parseRoute(`${ORIGIN}/uploader/lasthm`);
    expect(route.kind).toBe("list");
    if (route.kind === "list") {
      expect(route.scope).toBe("uploader");
      expect(route.query.text).toBe("uploader:lasthm$");
    }

    const cursor = parseRoute(`${ORIGIN}/uploader/lasthm?next=4276902`);
    if (cursor.kind === "list") {
      expect(cursor.query.text).toBe("uploader:lasthm$");
    }

    const spaced = parseRoute(`${ORIGIN}/uploader/Zero+Angel`);
    if (spaced.kind === "list") {
      expect(spaced.query.text).toBe('uploader:"Zero Angel$"');
    }
  });

  test("keeps the bare uploader index and deeper paths native", () => {
    expect(parseRoute(`${ORIGIN}/uploader/`).kind).toBe("native");
    expect(parseRoute(`${ORIGIN}/uploader/a/b`).kind).toBe("native");
  });

  test("separates galleries, viewer pages and unowned routes", () => {
    expect(parseRoute(`${ORIGIN}/g/123456/abcdef1234/`).kind).toBe("gallery");
    expect(parseRoute(`${ORIGIN}/s/abcdef1234/123456-3`).kind).toBe("viewer");
    expect(parseRoute(`${ORIGIN}/favorites.php`).kind).toBe("favorites");
    expect(parseRoute(`${ORIGIN}/torrents.php`).kind).toBe("torrents");
    expect(parseRoute(`${ORIGIN}/toplist.php`).kind).toBe("toplist");
    expect(parseRoute(`${ORIGIN}/uconfig.php`).kind).toBe("settings");
    expect(parseRoute(`${ORIGIN}/mytags`).kind).toBe("myTags");
    expect(parseRoute(`${ORIGIN}/gallerytorrents.php`).kind).toBe("galleryTorrents");
    expect(parseRoute(`${ORIGIN}/news.php`).kind).toBe("native");
    expect(parseRoute(`${ORIGIN}/?eh_native=1`).kind).toBe("native");
    expect(parseRoute("https://example.com/g/123456/abcdef1234/").kind).toBe("native");
  });
});
