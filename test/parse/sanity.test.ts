import { describe, expect, test } from "bun:test";

import { ParseMismatchError } from "../../src/fetch/errors";
import { parseFavorites } from "../../src/parse/favorites";
import { parseGalleryPage } from "../../src/parse/gallery";
import { parseListPage } from "../../src/parse/list";
import { parseSearchQuery } from "../../src/parse/query";
import {
  assertFavoritesPage,
  assertGalleryPage,
  assertListPage,
  assertSettingsPage,
  assertToplistPage,
  assertTorrentsPage,
  assertViewerPage,
} from "../../src/parse/sanity";
import { parseToplist } from "../../src/parse/toplist";
import { parseTorrents } from "../../src/parse/torrents";
import { parseUconfig } from "../../src/parse/uconfig";
import { parseViewer } from "../../src/parse/viewer";
import type { RouteOf } from "../../src/routes";
import { createRouteViews } from "../../src/routes";
import { loadFixture, parseDocument } from "../dom";

const VIEWER_URL = "https://e-hentai.org/s/hash123/987654-2";
const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";
const LIST_URL = "https://e-hentai.org/?f_search=test";
const TORRENTS_URL = "https://e-hentai.org/torrents.php";
const FAVORITES_URL = "https://exhentai.org/favorites.php?favcat=1";
const TOPLIST_URL = "https://e-hentai.org/toplist.php";

/** Run a check that must reject the page with the route's own mismatch error. */
function expectMismatch(route: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ParseMismatchError)) {
      throw error;
    }
    expect(error.name).toBe("ParseMismatchError");
    expect(error.route).toBe(route);
    return;
  }
  throw new Error(`expected the ${route} check to reject the page`);
}

describe("sanity checks on the site's pages", () => {
  test("accepts the viewer fixtures", async () => {
    for (const name of ["viewer.html", "viewer-last.html", "viewer-next-fallback.html"]) {
      const doc = await loadFixture(name);
      expect(() => assertViewerPage(parseViewer(doc, VIEWER_URL))).not.toThrow();
    }
  });

  test("accepts the gallery fixture", async () => {
    const doc = await loadFixture("gallery.html");
    expect(() => assertGalleryPage(parseGalleryPage(doc, GALLERY_URL))).not.toThrow();
  });

  test("accepts the list fixtures", async () => {
    const names = [
      "list.html",
      "list-thumbs.html",
      "list-uploader.html",
      "list-watched.html",
      "list-favorite.html",
    ];
    for (const name of names) {
      const doc = await loadFixture(name);
      expect(() => assertListPage(parseListPage(doc, LIST_URL), doc)).not.toThrow();
    }
  });

  test("accepts the torrent index fixture", async () => {
    const doc = await loadFixture("torrents.html");
    expect(() => assertTorrentsPage(parseTorrents(doc, TORRENTS_URL), doc)).not.toThrow();
  });

  test("accepts the favorites fixture", async () => {
    const doc = await loadFixture("favorites.html");
    expect(() => assertFavoritesPage(parseFavorites(doc, FAVORITES_URL))).not.toThrow();
  });

  test("accepts the toplist fixtures", async () => {
    const overview = parseToplist(await loadFixture("toplist.html"), TOPLIST_URL);
    expect(() => assertToplistPage(overview)).not.toThrow();

    const categoryDoc = await loadFixture("toplist-category.html");
    const category = parseToplist(categoryDoc, `${TOPLIST_URL}?tl=11`);
    expect(() => assertToplistPage(category)).not.toThrow();

    const usersDoc = await loadFixture("toplist-category-users.html");
    const users = parseToplist(usersDoc, `${TOPLIST_URL}?tl=21`);
    expect(() => assertToplistPage(users)).not.toThrow();
  });

  test("accepts the settings fixture", async () => {
    const doc = await loadFixture("uconfig.html");
    expect(() => assertSettingsPage(parseUconfig(doc))).not.toThrow();
  });
});

describe("sanity checks on broken pages", () => {
  test("rejects a viewer page without an image", () => {
    const doc = parseDocument("<html><body><h1>Broken</h1></body></html>");

    expectMismatch("viewer", () => assertViewerPage(parseViewer(doc, VIEWER_URL)));
  });

  test("rejects a gallery page with neither a title nor thumbnails", () => {
    const doc = parseDocument("<html><body></body></html>");

    expectMismatch("gallery", () => parseGalleryPage(doc, GALLERY_URL));
  });

  test("rejects a gallery page that kept its title but lost its thumbnails", () => {
    const doc = parseDocument('<html><body><div id="gn">Broken</div></body></html>');

    expectMismatch("gallery", () => assertGalleryPage(parseGalleryPage(doc, GALLERY_URL)));
  });

  test("rejects a gallery page with an empty primary title", async () => {
    const doc = await loadFixture("gallery.html");
    const data = parseGalleryPage(doc, GALLERY_URL);

    expectMismatch("gallery", () =>
      assertGalleryPage({ ...data, title: { ...data.title, primary: "" } }),
    );
  });

  test("rejects a list document without listing markup", () => {
    const doc = parseDocument("<html><body><p>Nothing familiar</p></body></html>");

    expectMismatch("list", () => assertListPage(parseListPage(doc, LIST_URL), doc));
  });

  test("rejects a torrent index without the results table", () => {
    const doc = parseDocument("<html><body><p>Nothing familiar</p></body></html>");

    expectMismatch("torrents", () => assertTorrentsPage(parseTorrents(doc, TORRENTS_URL), doc));
  });

  test("rejects a favorites page without the folder tabs", () => {
    const doc = parseDocument("<html><body></body></html>");

    expectMismatch("favorites", () => assertFavoritesPage(parseFavorites(doc, FAVORITES_URL)));
  });

  test("rejects a toplist overview without sections", () => {
    const doc = parseDocument("<html><body></body></html>");

    expectMismatch("toplist", () => assertToplistPage(parseToplist(doc, TOPLIST_URL)));
  });

  test("rejects a category toplist without entries", () => {
    const doc = parseDocument('<html><body><table class="itg"></table></body></html>');

    expectMismatch("toplist", () => assertToplistPage(parseToplist(doc, `${TOPLIST_URL}?tl=11`)));
  });

  test("rejects a settings page without a form", () => {
    const doc = parseDocument("<html><body></body></html>");

    expectMismatch("settings", () => assertSettingsPage(parseUconfig(doc)));
  });
});

describe("sanity checks on empty result pages", () => {
  test("accepts a list page with no items and a no-hits notice", () => {
    const doc = parseDocument(
      '<html><body><div class="searchtext"><p>No hits found.</p></div></body></html>',
    );
    const data = parseListPage(doc, LIST_URL);

    expect(data.items).toHaveLength(0);
    expect(data.resultText).toBe("No hits found.");
    expect(() => assertListPage(data, doc)).not.toThrow();
  });

  test("accepts a torrent index with no rows and a no-results notice", () => {
    const doc = parseDocument(
      '<html><body><table class="itg"></table><p class="ip">No torrents found.</p></body></html>',
    );
    const data = parseTorrents(doc, TORRENTS_URL);

    expect(data.rows).toHaveLength(0);
    expect(() => assertTorrentsPage(data, doc)).not.toThrow();
  });
});

describe("route adapters", () => {
  test("the list adapter's parse rejects a broken document", () => {
    const views = createRouteViews({
      document: () => Promise.reject(new Error("unexpected document load")),
      viewerPage: () => Promise.reject(new Error("unexpected viewer load")),
      seedViewerPage: () => undefined,
    });
    const route = {
      kind: "list",
      url: LIST_URL,
      query: parseSearchQuery(new URL(LIST_URL)),
      scope: "search",
    } satisfies RouteOf<"list">;
    const doc = parseDocument("<html><body><p>Nothing familiar</p></body></html>");

    expect(() => views.routeView(route).parse(doc, route)).toThrow(ParseMismatchError);
  });
});
