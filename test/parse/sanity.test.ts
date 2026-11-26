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
  test("accepts every supported fixture", async () => {
    for (const name of ["viewer.html", "viewer-last.html", "viewer-next-fallback.html"]) {
      assertViewerPage(parseViewer(await loadFixture(name), VIEWER_URL));
    }

    assertGalleryPage(parseGalleryPage(await loadFixture("gallery.html"), GALLERY_URL));

    for (const name of [
      "list.html",
      "list-thumbs.html",
      "list-uploader.html",
      "list-watched.html",
      "list-favorite.html",
    ]) {
      const doc = await loadFixture(name);
      assertListPage(parseListPage(doc, LIST_URL), doc);
    }

    const torrentDoc = await loadFixture("torrents.html");
    assertTorrentsPage(parseTorrents(torrentDoc, TORRENTS_URL), torrentDoc);

    assertFavoritesPage(parseFavorites(await loadFixture("favorites.html"), FAVORITES_URL));

    assertToplistPage(parseToplist(await loadFixture("toplist.html"), TOPLIST_URL));
    assertToplistPage(
      parseToplist(await loadFixture("toplist-category.html"), `${TOPLIST_URL}?tl=11`),
    );
    assertToplistPage(
      parseToplist(await loadFixture("toplist-category-users.html"), `${TOPLIST_URL}?tl=21`),
    );

    assertSettingsPage(parseUconfig(await loadFixture("uconfig.html")));
  });
});

describe("sanity checks on broken pages", () => {
  test("rejects a viewer page without an image", () => {
    const doc = parseDocument("<html><body><h1>Broken</h1></body></html>");

    expectMismatch("viewer", () => assertViewerPage(parseViewer(doc, VIEWER_URL)));
  });

  test("rejects a gallery page without thumbnails or a title", async () => {
    expectMismatch("gallery", () =>
      parseGalleryPage(parseDocument("<html><body></body></html>"), GALLERY_URL),
    );

    const titleOnly = parseDocument('<html><body><div id="gn">Broken</div></body></html>');
    expectMismatch("gallery", () => assertGalleryPage(parseGalleryPage(titleOnly, GALLERY_URL)));

    const data = parseGalleryPage(await loadFixture("gallery.html"), GALLERY_URL);
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

  test("rejects toplist pages without sections or ranked entries", () => {
    expectMismatch("toplist", () =>
      assertToplistPage(parseToplist(parseDocument("<html><body></body></html>"), TOPLIST_URL)),
    );
    expectMismatch("toplist", () =>
      assertToplistPage(
        parseToplist(
          parseDocument('<html><body><table class="itg"></table></body></html>'),
          `${TOPLIST_URL}?tl=11`,
        ),
      ),
    );
  });

  test("rejects a settings page without a form", () => {
    const doc = parseDocument("<html><body></body></html>");

    expectMismatch("settings", () => assertSettingsPage(parseUconfig(doc)));
  });
});

describe("sanity checks on empty result pages", () => {
  test("accepts empty listings and torrent indexes that carry the site's notices", () => {
    const listDoc = parseDocument(
      '<html><body><div class="searchtext"><p>No hits found.</p></div></body></html>',
    );
    const list = parseListPage(listDoc, LIST_URL);
    expect(list.items).toHaveLength(0);
    expect(list.resultText).toBe("No hits found.");
    assertListPage(list, listDoc);

    const torrentDoc = parseDocument(
      '<html><body><table class="itg"></table><p class="ip">No torrents found.</p></body></html>',
    );
    const torrents = parseTorrents(torrentDoc, TORRENTS_URL);
    expect(torrents.rows).toHaveLength(0);
    assertTorrentsPage(torrents, torrentDoc);
  });

  test("accepts the site's bare no-hits notice, which has no search summary", () => {
    // The live no-hits page carries `#searchbox` but no `.searchtext`; the notice is a lone
    // centered paragraph, so the parser must find it instead of leaving `resultText` null.
    const doc = parseDocument(
      "<html><body><div class='ido'><div id='toppane'><div id='searchbox'></div></div>" +
        "<div style='position:relative; z-index:2'>" +
        "<p style='text-align:center; font-style:italic; margin-bottom:10px'>No hits found</p>" +
        "</div></div></body></html>",
    );
    const list = parseListPage(doc, LIST_URL);
    expect(list.items).toHaveLength(0);
    expect(list.resultText).toBe("No hits found");
    assertListPage(list, doc);
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
