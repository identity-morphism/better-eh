import { beforeEach, describe, expect, test } from "bun:test";

import { parseRoute } from "../../src/router";
import type { ListScope } from "../../src/routes/types";

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

  test("classifies listing addresses into scoped lists", () => {
    const cases: readonly [path: string, scope: ListScope][] = [
      ["/", "search"],
      ["/doujinshi", "search"],
      ["/tag/language:chinese", "search"],
      ["/popular", "popular"],
      ["/watched", "watched"],
    ];

    for (const [path, scope] of cases) {
      const route = parseRoute(`${ORIGIN}${path}`);
      expect(route.kind, path).toBe("list");
      if (route.kind === "list") {
        expect(route.scope, path).toBe(scope);
      }
    }

    const searched = parseRoute(`${ORIGIN}/popular?f_search=test`);
    if (searched.kind === "list") {
      expect(searched.scope).toBe("popular");
      expect(searched.query.text).toBe("test");
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

    // The bare index is a directory, and deeper paths are not a single uploader.
    expect(parseRoute(`${ORIGIN}/uploader/`).kind).toBe("native");
    expect(parseRoute(`${ORIGIN}/uploader/a/b`).kind).toBe("native");
  });

  test("separates galleries, viewer pages and unowned routes", () => {
    expect(parseRoute(`${ORIGIN}/g/123456/abcdef1234/`).kind).toBe("gallery");
    expect(parseRoute(`${ORIGIN}/s/abcdef1234/123456-3`).kind).toBe("viewer");
    expect(parseRoute(`${ORIGIN}/favorites.php`).kind).toBe("favorites");
    expect(parseRoute(`${ORIGIN}/home.php`).kind).toBe("home");
    expect(parseRoute(`${ORIGIN}/torrents.php`).kind).toBe("torrents");
    expect(parseRoute(`${ORIGIN}/toplist.php`).kind).toBe("toplist");
    expect(parseRoute(`${ORIGIN}/uconfig.php`).kind).toBe("settings");
    expect(parseRoute(`${ORIGIN}/mytags`).kind).toBe("myTags");
    expect(parseRoute(`${ORIGIN}/gallerytorrents.php`).kind).toBe("galleryTorrents");
    expect(parseRoute(`${ORIGIN}/archiver.php?gid=1&token=aa`).kind).toBe("archive");
    expect(parseRoute(`${ORIGIN}/news.php`).kind).toBe("news");
    expect(parseRoute(`${ORIGIN}/?eh_native=1`).kind).toBe("native");
    expect(parseRoute("https://example.com/g/123456/abcdef1234/").kind).toBe("native");
  });
});
