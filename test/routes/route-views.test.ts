import { describe, expect, test } from "bun:test";

import { saveListFilters } from "../../src/data/list-filters";
import { ParseMismatchError } from "../../src/fetch/errors";
import type { DocumentOptions, ViewerPageOptions } from "../../src/fetch/loader";
import { priorityOf } from "../../src/net/priority";
import { parseGalleryPage } from "../../src/parse/gallery";
import { emptySearchQuery, parseSearchQuery } from "../../src/parse/query";
import { parseViewer } from "../../src/parse/viewer";
import type { Route } from "../../src/router";
import { parseRoute } from "../../src/router";
import type { RouteOf, RouteViews } from "../../src/routes";
import { createRouteViews } from "../../src/routes";
import type { RouteViewDeps } from "../../src/routes/types";
import { loadFixture } from "../dom";

// Titles carry the host's own name, so pin the host these adapters are tested against.
Object.assign(globalThis, { location: new URL("https://e-hentai.org/") });

const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";
const LIST_URL = "https://e-hentai.org/?f_search=test";
const VIEWER_URL = "https://e-hentai.org/s/hash123/987654-2";
const TORRENTS_URL = "https://e-hentai.org/torrents.php";
const HOME_URL = "https://e-hentai.org/home.php";
const ARCHIVE_URL = "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234";
const GALLERY_TORRENTS_URL = "https://e-hentai.org/gallerytorrents.php?gid=987654&t=abcdef1234";

const galleryDoc = await loadFixture("gallery.html");
const galleryTorrentsDoc = await loadFixture("gallerytorrents.html");
const listDoc = await loadFixture("list.html");
const torrentsDoc = await loadFixture("torrents.html");
const viewerDoc = await loadFixture("viewer.html");
const uconfigDoc = await loadFixture("uconfig.html");
const favoritesDoc = await loadFixture("favorites.html");
const toplistDoc = await loadFixture("toplist.html");
const homeDoc = await loadFixture("home.html");
const archiveDoc = await loadFixture("archive.html");

/** Fixtures keyed by the URL each page route is loaded from. */
const DOCS: Record<string, Document> = {
  [LIST_URL]: listDoc,
  [TORRENTS_URL]: torrentsDoc,
  [GALLERY_TORRENTS_URL]: galleryTorrentsDoc,
  "https://e-hentai.org/uconfig.php": uconfigDoc,
  "https://e-hentai.org/favorites.php": favoritesDoc,
  "https://e-hentai.org/toplist.php": toplistDoc,
  [HOME_URL]: homeDoc,
  [ARCHIVE_URL]: archiveDoc,
};

const galleryRoute = { kind: "gallery", url: GALLERY_URL } satisfies RouteOf<"gallery">;
const listRoute = {
  kind: "list",
  url: LIST_URL,
  query: parseSearchQuery(new URL(LIST_URL)),
  scope: "search",
} satisfies RouteOf<"list">;
const viewerRoute = { kind: "viewer", url: VIEWER_URL } satisfies RouteOf<"viewer">;
const torrentsRoute = { kind: "torrents", url: TORRENTS_URL } satisfies RouteOf<"torrents">;
const homeRoute = { kind: "home", url: HOME_URL } satisfies RouteOf<"home">;
const archiveRoute = { kind: "archive", url: ARCHIVE_URL } satisfies RouteOf<"archive">;
const galleryTorrentsRoute = {
  kind: "galleryTorrents",
  url: GALLERY_TORRENTS_URL,
} satisfies RouteOf<"galleryTorrents">;

const viewerData = parseViewer(viewerDoc, VIEWER_URL);

interface DocCall {
  url: string;
  options: DocumentOptions;
}

interface ViewerCall {
  url: string;
  options: ViewerPageOptions;
}

interface SeedCall {
  url: string;
  data: unknown;
}

interface Harness {
  views: RouteViews;
  docCalls: DocCall[];
  viewerCalls: ViewerCall[];
  seedCalls: SeedCall[];
}

function harness(): Harness {
  const docCalls: DocCall[] = [];
  const viewerCalls: ViewerCall[] = [];
  const seedCalls: SeedCall[] = [];

  const deps: RouteViewDeps = {
    document: (url, options) => {
      docCalls.push({ url, options: options ?? {} });
      return Promise.resolve({ doc: DOCS[url] ?? galleryDoc, url });
    },
    viewerPage: (url, options) => {
      viewerCalls.push({ url, options: options ?? {} });
      return Promise.resolve(viewerData);
    },
    seedViewerPage: (url, data) => {
      seedCalls.push({ url, data });
    },
  };

  return { views: createRouteViews(deps), docCalls, viewerCalls, seedCalls };
}

interface DocumentLoadExpectation {
  url: string;
  signal: AbortSignal;
  priority: Parameters<typeof priorityOf>[0];
  tag: string;
}

function expectDocumentLoad(call: DocCall | undefined, expected: DocumentLoadExpectation): void {
  if (call === undefined) {
    throw new Error(`expected the ${expected.tag} document load`);
  }
  expect(call.url).toBe(expected.url);
  expect(call.options.signal).toBe(expected.signal);
  expect(call.options.priority).toBe(priorityOf(expected.priority));
  expect(call.options.tag).toBe(expected.tag);
}

interface PageSourceExpectation {
  /** The slice page one's parser produces, which the appended page must match. */
  page: unknown;
  url: string;
  signal: AbortSignal;
  tag: string;
  calls: DocCall[];
}

async function expectPageSource(
  source: ((url: string, signal: AbortSignal) => Promise<unknown>) | undefined,
  expected: PageSourceExpectation,
): Promise<void> {
  if (source === undefined) {
    throw new Error(`expected a ${expected.tag} page source`);
  }
  expect(await source(expected.url, expected.signal)).toEqual(expected.page);
  expect(expected.calls).toHaveLength(1);
  expectDocumentLoad(expected.calls[0], {
    url: expected.url,
    signal: expected.signal,
    priority: "append",
    tag: expected.tag,
  });
}

describe("createRouteViews routing", () => {
  test("rejects native and unknown route kinds instead of falling back to another view", () => {
    const { views } = harness();
    const routes: Route[] = [
      { kind: "native", url: "https://example.com/" },
      { kind: "external", url: "https://example.com/" } as unknown as Route,
    ];

    for (const route of routes) {
      expect(() => views.routeView(route)).toThrow();
    }
  });
});

describe("home route", () => {
  test("loads the account overview through the injected loader and titles it", async () => {
    const { views, docCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(homeRoute).load(homeRoute, signal);

    expect(data.sections).toHaveLength(5);
    expectDocumentLoad(docCalls[0], {
      url: HOME_URL,
      signal,
      priority: "navigation",
      tag: "home",
    });
    expect(views.routeView(homeRoute).title(data)).toBe("My Home - E-Hentai");
  });
});

describe("settings route", () => {
  test("loads past the document cache, because a save changes this page", async () => {
    const route = {
      kind: "settings",
      url: "https://e-hentai.org/uconfig.php",
    } satisfies RouteOf<"settings">;
    const { views, docCalls } = harness();

    const data = await views.routeView(route).load(route, new AbortController().signal);

    expect(docCalls).toHaveLength(1);
    expect(docCalls[0]?.options.fresh).toBe(true);
    expect(views.routeView(route).title(data)).toBe("Settings - E-Hentai");
  });
});

describe("viewer route", () => {
  test("loads through the injected viewer loader only", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(viewerRoute).load(viewerRoute, signal);

    expect(data).toBe(viewerData);
    expect(docCalls).toHaveLength(0);
    expect(viewerCalls).toHaveLength(1);
    expect(viewerCalls[0]?.url).toBe(VIEWER_URL);
    expect(viewerCalls[0]?.options.signal).toBe(signal);
    expect(viewerCalls[0]?.options.priority).toBe(priorityOf("navigation"));
  });

  test("rejects a loaded page whose image the parser could not resolve", async () => {
    const views = createRouteViews({
      document: () => Promise.reject(new Error("unexpected document load")),
      viewerPage: () => Promise.resolve({ ...viewerData, imgSrc: "" }),
      seedViewerPage: () => undefined,
    });

    await expect(
      views.routeView(viewerRoute).load(viewerRoute, new AbortController().signal),
    ).rejects.toThrow(ParseMismatchError);
  });

  test("parses the initial document, seeds the page cache and titles the page", () => {
    const { views, seedCalls } = harness();

    const data = views.routeView(viewerRoute).parse(viewerDoc, viewerRoute);

    expect(data.viewerUrl).toBe(VIEWER_URL);
    expect(data.pageNum).toBe(2);
    expect(seedCalls).toHaveLength(1);
    expect(seedCalls[0]?.url).toBe(VIEWER_URL);
    expect(seedCalls[0]?.data).toBe(data);
    expect(views.routeView(viewerRoute).title(data)).toBe("A Viewer Title - 2 / 3 - E-Hentai");
  });
});

describe("gallery route", () => {
  test("loads through the injected document loader as a gallery", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(galleryRoute).load(galleryRoute, signal);

    expect(data.gid).toBe("123456");
    expect(viewerCalls).toHaveLength(0);
    expect(docCalls).toHaveLength(1);
    expectDocumentLoad(docCalls[0], {
      url: GALLERY_URL,
      signal,
      priority: "navigation",
      tag: "gallery",
    });
  });

  test("keeps the loader's final URL instead of the requested one", async () => {
    const finalUrl = "https://e-hentai.org/g/999999/ffff/";
    const views = createRouteViews({
      document: () => Promise.resolve({ doc: galleryDoc, url: finalUrl }),
      viewerPage: () => Promise.reject(new Error("unexpected viewer load")),
      seedViewerPage: () => undefined,
    });

    const data = await views
      .routeView(galleryRoute)
      .load(galleryRoute, new AbortController().signal);

    // One build call feeds both entry points, so the loader is the authority on the address.
    expect(data.url).toBe(finalUrl);
    expect(data.gid).toBe("999999");
  });

  test("titles the page and shares page one's loader and parser with the append feed", async () => {
    const { views, docCalls } = harness();
    const signal = new AbortController().signal;
    const parsed = parseGalleryPage(galleryDoc, GALLERY_URL);

    expect(views.routeView(galleryRoute).title(parsed)).toBe("The Great Work - E-Hentai");

    await expectPageSource(views.routeView(galleryRoute).feed?.(galleryRoute), {
      page: { items: parsed.thumbs, next: parsed.nextHref },
      url: GALLERY_URL,
      signal,
      tag: "gallery",
      calls: docCalls,
    });
  });
});

describe("route address policy", () => {
  test("a listing fills remembered filters and redirects boot to the effective address", () => {
    saveListFilters({ ...emptySearchQuery(), cats: 6, rating: 4 });
    try {
      const { views } = harness();
      const prepared = views.routeView(listRoute).prepare(listRoute, {
        previous: null,
        replace: true,
        previousState: {},
      });

      const url = new URL(prepared.route.url);
      expect(url.searchParams.get("f_cats")).toBe("6");
      expect(url.searchParams.get("f_srdd")).toBe("4");
      expect(prepared.bootUrl).toBe(prepared.route.url);

      const moved = views.routeView(listRoute).prepare(listRoute, {
        previous: galleryRoute,
        replace: false,
        previousState: {},
      });
      expect(moved.bootUrl).toBeNull();
      expect(moved.route.url).toContain("f_cats=6");
    } finally {
      saveListFilters(emptySearchQuery());
    }
  });

  test("a date range starts a cold listing at the site's seek cursor and loads from it", async () => {
    const url = "https://e-hentai.org/?eh_since=2024-01-01&eh_until=2024-12-31";
    const route = {
      kind: "list",
      url,
      query: parseSearchQuery(new URL(url)),
      scope: "search",
    } satisfies RouteOf<"list">;
    const docCalls: DocCall[] = [];
    const views = createRouteViews({
      document: (requestUrl, options) => {
        docCalls.push({ url: requestUrl, options: options ?? {} });
        return Promise.resolve({ doc: listDoc, url: requestUrl });
      },
      viewerPage: () => Promise.reject(new Error("unexpected viewer load")),
      seedViewerPage: () => undefined,
    });

    const prepared = views.routeView(route).prepare(route, {
      previous: null,
      replace: true,
      previousState: {},
    });
    expect(new URL(prepared.bootUrl ?? "").searchParams.get("seek")).toBe("2024-12-31");

    await views.routeView(route).load(route, new AbortController().signal);
    expect(new URL(docCalls[0]?.url ?? "").searchParams.get("seek")).toBe("2024-12-31");
  });

  test("the viewer carries the gallery-return marker through its own replace-navigations", () => {
    const { views } = harness();

    const entered = views.routeView(viewerRoute).prepare(viewerRoute, {
      previous: galleryRoute,
      replace: false,
      previousState: {},
    });
    expect(entered.state).toEqual({ fromGallery: true });

    const replaced = views.routeView(viewerRoute).prepare(viewerRoute, {
      previous: viewerRoute,
      replace: true,
      previousState: { fromGallery: true },
    });
    expect(replaced.state).toEqual({ fromGallery: true });

    const fromList = views.routeView(viewerRoute).prepare(viewerRoute, {
      previous: listRoute,
      replace: false,
      previousState: {},
    });
    expect(fromList.state).toEqual({ fromGallery: false });
  });

  test("other routes leave their address and history state alone", () => {
    const { views } = harness();
    const prepared = views.routeView(galleryRoute).prepare(galleryRoute, {
      previous: listRoute,
      replace: false,
      previousState: {},
    });

    expect(prepared.route).toBe(galleryRoute);
    expect(prepared.bootUrl).toBeNull();
    expect(prepared.state).toEqual({});
  });
});

describe("list route", () => {
  test("loads through the injected document loader as a list and keeps the query", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(listRoute).load(listRoute, signal);

    expect(data.page.items).toHaveLength(2);
    expect(data.query).toBe(listRoute.query);
    expect(viewerCalls).toHaveLength(0);
    expect(docCalls).toHaveLength(1);
    expectDocumentLoad(docCalls[0], {
      url: LIST_URL,
      signal,
      priority: "navigation",
      tag: "list",
    });
  });

  test("titles a listing by its search text, category or tag path", () => {
    const { views } = harness();

    const search = {
      kind: "list",
      url: LIST_URL,
      query: parseSearchQuery(new URL(LIST_URL)),
      scope: "search",
    } satisfies RouteOf<"list">;
    const searchData = views.routeView(search).parse(listDoc, search);
    expect(views.routeView(search).title(searchData)).toBe("test - E-Hentai");

    const category = parseRoute("https://e-hentai.org/doujinshi");
    if (category.kind !== "list") {
      throw new Error("expected a list route");
    }
    const categoryData = views.routeView(category).parse(listDoc, category);
    expect(views.routeView(category).title(categoryData)).toBe("Doujinshi - E-Hentai");

    const tag = parseRoute("https://e-hentai.org/tag/language:chinese");
    if (tag.kind !== "list") {
      throw new Error("expected a list route");
    }
    const tagData = views.routeView(tag).parse(listDoc, tag);
    expect(views.routeView(tag).title(tagData)).toBe("l:chinese$ - E-Hentai");
  });
});

describe("torrents route", () => {
  test("loads the torrent index, parses its rows and titles the page", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(torrentsRoute).load(torrentsRoute, signal);

    expect(data.rows.length).toBeGreaterThan(0);
    expect(viewerCalls).toHaveLength(0);
    expect(docCalls).toHaveLength(1);
    expectDocumentLoad(docCalls[0], {
      url: TORRENTS_URL,
      signal,
      priority: "navigation",
      tag: "torrents",
    });
    expect(views.routeView(torrentsRoute).title(data)).toBe("Torrents - E-Hentai");
  });
});

describe("gallery torrents route", () => {
  test("loads the gallery's torrent popup and titles the page with the gallery name", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(galleryTorrentsRoute).load(galleryTorrentsRoute, signal);

    expect(data.torrents).toHaveLength(2);
    expect(viewerCalls).toHaveLength(0);
    expect(docCalls).toHaveLength(1);
    expectDocumentLoad(docCalls[0], {
      url: GALLERY_TORRENTS_URL,
      signal,
      priority: "navigation",
      tag: "gallery-torrents",
    });
    expect(views.routeView(galleryTorrentsRoute).title(data)).toBe(
      "Torrents for Test Gallery - E-Hentai",
    );
  });
});

describe("archive route", () => {
  test("loads the chooser fresh and titles the page", async () => {
    const { views, docCalls, viewerCalls } = harness();
    const signal = new AbortController().signal;

    const data = await views.routeView(archiveRoute).load(archiveRoute, signal);

    expect(data.original?.kind).toBe("original");
    expect(data.resample?.kind).toBe("resample");
    expect(viewerCalls).toHaveLength(0);
    expect(docCalls).toHaveLength(1);
    expectDocumentLoad(docCalls[0], {
      url: ARCHIVE_URL,
      signal,
      priority: "navigation",
      tag: "archive",
    });
    expect(docCalls[0]?.options.fresh).toBe(true);
    expect(views.routeView(archiveRoute).title(data)).toBe("Archive Download - E-Hentai");
  });
});

describe("account and ranking pages", () => {
  test("titles the active favorite folder and ranking", () => {
    const { views } = harness();

    const favorites = {
      kind: "favorites",
      url: "https://e-hentai.org/favorites.php",
    } satisfies RouteOf<"favorites">;
    const favoritesData = views.routeView(favorites).parse(favoritesDoc, favorites);
    expect(views.routeView(favorites).title(favoritesData)).toBe(
      "Plan to Read - Favorites - E-Hentai",
    );

    const toplist = {
      kind: "toplist",
      url: "https://e-hentai.org/toplist.php",
    } satisfies RouteOf<"toplist">;
    const toplistData = views.routeView(toplist).parse(toplistDoc, toplist);
    expect(views.routeView(toplist).title(toplistData)).toBe("Toplists - E-Hentai");
  });
});
