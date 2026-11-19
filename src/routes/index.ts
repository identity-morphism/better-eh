import { listRequestUrl } from "../data/list-date";
import type { HtmlResponse } from "../fetch/loader";
import { loader } from "../fetch/loader";
import type { Priority } from "../net/priority";
import { priorityOf } from "../net/priority";
import { parseFavorites } from "../parse/favorites";
import { parseGalleryPage } from "../parse/gallery";
import { parseGalleryTorrents } from "../parse/gallery-torrents";
import { parseHome } from "../parse/home";
import { parseListPage } from "../parse/list";
import { parseMyTags } from "../parse/my-tags";
import { parseSearchQuery, tagTokenFromHref, uploaderTokenFromHref } from "../parse/query";
import {
  assertFavoritesPage,
  assertGalleryPage,
  assertGalleryTorrentsPage,
  assertHomePage,
  assertListPage,
  assertMyTagsPage,
  assertSettingsPage,
  assertToplistPage,
  assertTorrentsPage,
  assertViewerPage,
} from "../parse/sanity";
import { parseToplist } from "../parse/toplist";
import { parseTorrents } from "../parse/torrents";
import { parseUconfig } from "../parse/uconfig";
import { parseViewer } from "../parse/viewer";
import { documentTitle } from "../site";
import type { GalleryThumb, ListItem } from "../types";
import type { CursorPage } from "../ui/page-cursor";
import type { PageSource, ViewContext } from "../views/context";
import { favoritesLabels, renderFavorites } from "../views/favorites";
import { renderGallery } from "../views/gallery";
import { renderGalleryTorrents } from "../views/gallery-torrents";
import { renderHome } from "../views/home";
import { listLabels, renderList } from "../views/list";
import { renderMyTags } from "../views/my-tags";
import { renderSettings } from "../views/settings";
import { renderToplist } from "../views/toplist";
import { renderTorrents } from "../views/torrents";
import { mountViewer } from "../views/viewer";
import {
  ALL_CATEGORY_BITS,
  categoryPathBit,
  GALLERY_PATH,
  SCOPE_PATHS,
  UPLOADER_PATH,
  VIEWER_PATH,
} from "./identity";
import type {
  LoadOptions,
  OwnedKind,
  OwnedRoute,
  Route,
  RouteDataByKind,
  RouteOf,
  RouteTable,
  RouteView,
  RouteViewDeps,
  RouteViewFor,
} from "./types";

/** The table-backed way to reach a route's adapter or to classify a URL. */
export interface RouteViews {
  /** Resolve the adapter for an owned route, retaining the kind's data type. */
  routeView<K extends OwnedKind>(route: RouteOf<K>): RouteViewFor<K>;
  routeView(route: Route): RouteView<unknown>;
  /** Classify a URL against the owned kinds; null means the site owns the page. */
  match(url: URL): OwnedRoute | null;
}

/** The per-route data of a document route: how to parse it, draw it, name it, and how to fetch it. */
interface DocumentSpec<K extends OwnedKind, I = unknown> {
  /** Queue tag the document load carries. */
  tag: string;
  /**
   * Address to fetch instead of the route's own, when the route has to be translated before the
   * site sees it (e.g. the app's date range becomes the site's `seek` cursor).
   */
  request?: (route: RouteOf<K>) => string;
  /** Parse the document; `url` is the loader's final address, not the requested one. */
  parse(doc: Document, url: string, route: RouteOf<K>): RouteDataByKind[K];
  /** Reject a page whose markup no longer matches the view; the app then opens the native page. */
  sanity?: (data: RouteDataByKind[K], doc: Document) => void;
  /** Parse one appended page from the same document; omitted when the route does not paginate. */
  page?: (doc: Document, url: string) => CursorPage<I>;
  render(
    host: HTMLElement,
    data: RouteDataByKind[K],
    ctx: ViewContext,
    pageSource?: PageSource<I>,
  ): void;
  title(data: RouteDataByKind[K]): string;
  /** Load past the document cache; the shell can change a page's server state, and then it lies. */
  fresh?: boolean;
}

/**
 * Build one document route's adapter: the loaded document, parsed by `spec`, is the only data
 * source for both entry points, so a redirect cannot leave the data pointing at the requested URL.
 *
 * A paginated spec also gets a page source built from the same document loader, tag and parse
 * function, so appended pages cannot drift from page one; only the request class changes.
 */
function documentView<K extends OwnedKind, I = unknown>(
  deps: RouteViewDeps,
  spec: DocumentSpec<K, I>,
): RouteViewFor<K> {
  const fetchDocument = (
    url: string,
    signal: AbortSignal,
    priority: Priority,
    options?: LoadOptions,
  ): Promise<HtmlResponse> =>
    deps.document(url, {
      signal,
      priority,
      tag: spec.tag,
      ...(spec.fresh === true || options?.fresh === true ? { fresh: true } : {}),
    });

  const page = spec.page;
  const pageSource: PageSource<I> | undefined =
    page === undefined
      ? undefined
      : async (url, signal) => {
          const { doc, url: finalUrl } = await fetchDocument(url, signal, priorityOf("append"));
          return page(doc, finalUrl);
        };

  return {
    load: async (route, signal, options) => {
      const { doc, url } = await fetchDocument(
        spec.request?.(route) ?? route.url,
        signal,
        priorityOf("navigation"),
        options,
      );
      const data = spec.parse(doc, url, route);
      spec.sanity?.(data, doc);
      return data;
    },
    parse: (doc, route) => {
      const data = spec.parse(doc, route.url, route);
      spec.sanity?.(data, doc);
      return data;
    },
    render: (host, data, ctx) => spec.render(host, data, ctx, pageSource),
    title: (data) => spec.title(data),
    pageSource,
  };
}

/**
 * Build the route table. Each entry pairs the URL shape that produces its kind with the adapter
 * that renders it; the mapped type makes a missing or mismatched kind a compile error.
 */
export function createRouteViews(deps: RouteViewDeps): RouteViews {
  const table: RouteTable = {
    viewer: {
      match: (url) => (VIEWER_PATH.test(url.pathname) ? { kind: "viewer", url: url.href } : null),
      // The loader returns parsed pages itself, so only the initial document needs a parse call.
      load: async (route, signal) => {
        const data = await deps.viewerPage(route.url, {
          signal,
          priority: priorityOf("navigation"),
        });
        assertViewerPage(data);
        return data;
      },
      parse: (doc, route) => {
        const data = parseViewer(doc, route.url);
        assertViewerPage(data);
        // The initial document never went through the page loader; seed it for prefetch.
        deps.seedViewerPage(data.viewerUrl, data);
        return data;
      },
      render: mountViewer,
      title: (data) => documentTitle(data.galleryTitle.primary, data.counterText),
    },
    gallery: {
      match: (url) => (GALLERY_PATH.test(url.pathname) ? { kind: "gallery", url: url.href } : null),
      ...documentView<"gallery", GalleryThumb>(deps, {
        tag: "gallery",
        parse: parseGalleryPage,
        sanity: assertGalleryPage,
        page: (doc, url) => {
          const page = parseGalleryPage(doc, url);
          return { items: page.thumbs, next: page.nextHref };
        },
        render: (host, data, ctx, pageSource) => renderGallery(host, data, ctx, { pageSource }),
        title: (data) => documentTitle(data.title.primary),
      }),
    },
    list: {
      match: (url) => {
        if (UPLOADER_PATH.test(url.pathname)) {
          const text = uploaderTokenFromHref(url.href, url.href);
          if (text !== null) {
            return {
              kind: "list",
              url: url.href,
              query: { ...parseSearchQuery(url), text },
              scope: "uploader",
            };
          }
        }

        const categoryBit = categoryPathBit(url.pathname);
        if (categoryBit !== null || url.pathname.startsWith("/tag/")) {
          const query = parseSearchQuery(url);
          if (categoryBit !== null && categoryBit !== 0) {
            // A category path shows one category. Carry that into the query so the filter chips
            // and the heading describe the same result set, and so the next search keeps the
            // category.
            query.cats = ALL_CATEGORY_BITS & ~categoryBit;
          }
          return { kind: "list", url: url.href, query, scope: "search" };
        }

        const scope = SCOPE_PATHS[url.pathname];
        if (scope !== undefined) {
          return { kind: "list", url: url.href, query: parseSearchQuery(url), scope };
        }

        return null;
      },
      ...documentView<"list", ListItem>(deps, {
        tag: "list",
        request: (route) => listRequestUrl(route.url),
        parse: (doc, url, route) => ({
          page: parseListPage(doc, url),
          query: route.query,
          scope: route.scope,
        }),
        sanity: (data, doc) => assertListPage(data.page, doc),
        page: (doc, url) => {
          const page = parseListPage(doc, url);
          return { items: page.items, next: page.nextHref };
        },
        render: (host, data, ctx, pageSource) =>
          renderList(host, data.page, data.query, ctx, data.scope, { pageSource }),
        title: (data) => {
          const pathTag = tagTokenFromHref(new URL(data.page.url).pathname, data.page.url);
          return documentTitle(listLabels(data.query, data.scope, pathTag).title);
        },
      }),
    },
    torrents: {
      match: (url) =>
        url.pathname === "/torrents.php" ? { kind: "torrents", url: url.href } : null,
      ...documentView<"torrents">(deps, {
        tag: "torrents",
        parse: parseTorrents,
        sanity: assertTorrentsPage,
        render: renderTorrents,
        title: () => documentTitle("Torrents"),
      }),
    },
    galleryTorrents: {
      match: (url) =>
        url.pathname === "/gallerytorrents.php" ? { kind: "galleryTorrents", url: url.href } : null,
      ...documentView<"galleryTorrents">(deps, {
        tag: "gallery-torrents",
        parse: parseGalleryTorrents,
        sanity: assertGalleryTorrentsPage,
        render: (host, data, ctx) => renderGalleryTorrents(host, data, ctx),
        title: (data) =>
          documentTitle(data.title === "" ? "Torrents" : `Torrents for ${data.title}`),
      }),
    },
    home: {
      match: (url) => (url.pathname === "/home.php" ? { kind: "home", url: url.href } : null),
      ...documentView<"home">(deps, {
        tag: "home",
        parse: parseHome,
        sanity: assertHomePage,
        render: (host, data, ctx) => renderHome(host, data, ctx),
        title: () => documentTitle("My Home"),
      }),
    },
    myTags: {
      match: (url) =>
        /^\/mytags\/?$/u.test(url.pathname) ? { kind: "myTags", url: url.href } : null,
      ...documentView<"myTags">(deps, {
        tag: "my-tags",
        parse: parseMyTags,
        sanity: assertMyTagsPage,
        render: (host, data, ctx) => renderMyTags(host, data, ctx),
        title: () => documentTitle("My Tags"),
      }),
    },
    favorites: {
      match: (url) =>
        url.pathname === "/favorites.php" ? { kind: "favorites", url: url.href } : null,
      ...documentView<"favorites">(deps, {
        tag: "favorites",
        parse: parseFavorites,
        sanity: assertFavoritesPage,
        render: (host, data, ctx) => renderFavorites(host, data, ctx),
        title: (data) => documentTitle(...favoritesLabels(data).title),
      }),
    },
    toplist: {
      match: (url) => (url.pathname === "/toplist.php" ? { kind: "toplist", url: url.href } : null),
      ...documentView<"toplist">(deps, {
        tag: "toplist",
        parse: parseToplist,
        sanity: assertToplistPage,
        render: renderToplist,
        title: (data) =>
          data.kind === "category" ? documentTitle(data.title) : documentTitle("Toplists"),
      }),
    },
    settings: {
      match: (url) =>
        url.pathname === "/uconfig.php" ? { kind: "settings", url: url.href } : null,
      ...documentView<"settings">(deps, {
        tag: "settings",
        // The settings page reads no URL.
        parse: parseUconfig,
        sanity: assertSettingsPage,
        render: (host, data, ctx) => renderSettings(host, data, ctx),
        title: () => documentTitle("Settings"),
        // A save changes this page's server state, so the cached copy is the pre-save page.
        fresh: true,
      }),
    },
  };

  function routeView<K extends OwnedKind>(route: RouteOf<K>): RouteViewFor<K>;
  function routeView(route: Route): RouteView<unknown>;
  function routeView(route: Route): RouteView<unknown> {
    if (route.kind === "native" || !Object.hasOwn(table, route.kind)) {
      throw new Error(`Cannot render a ${route.kind} route`);
    }
    return table[route.kind];
  }

  function match(url: URL): OwnedRoute | null {
    // The kinds' path shapes are disjoint, so table order only keeps the scan deterministic.
    const entries: readonly { match(url: URL): OwnedRoute | null }[] = Object.values(table);
    for (const entry of entries) {
      const route = entry.match(url);
      if (route !== null) {
        return route;
      }
    }
    return null;
  }

  return { routeView, match };
}

const productionViews = createRouteViews(loader);

export const routeView: RouteViews["routeView"] = (route: Route) =>
  productionViews.routeView(route);

/** Production owned-route classifier, used by `parseRoute` after its origin checks. */
export const matchOwnedRoute: RouteViews["match"] = (url: URL) => productionViews.match(url);

export type { RouteOf, RouteView } from "./types";
