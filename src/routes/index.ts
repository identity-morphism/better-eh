import {
  filterByDateRange,
  isDateRangeActive,
  listRequestUrl,
  withDateRange,
} from "../data/list-date";
import type { DateRange } from "../data/list-date";
import { applyPersistedListFilters } from "../data/list-filters";
import type { HtmlResponse } from "../fetch/loader";
import { loader } from "../fetch/loader";
import type { Priority } from "../net/priority";
import { priorityOf } from "../net/priority";
import { parseArchivePage } from "../parse/archive";
import { parseFavorites } from "../parse/favorites";
import { parseGalleryPage, parseGalleryThumbPage } from "../parse/gallery";
import { parseGalleryTorrents } from "../parse/gallery-torrents";
import { parseHome } from "../parse/home";
import { parseListPage } from "../parse/list";
import { parseMyTags } from "../parse/my-tags";
import { parseNews } from "../parse/news";
import { parseSearchQuery, tagTokenFromHref, uploaderTokenFromHref } from "../parse/query";
import {
  assertArchivePage,
  assertFavoritesPage,
  assertGalleryPage,
  assertGalleryTorrentsPage,
  assertHomePage,
  assertListPage,
  assertMyTagsPage,
  assertNewsPage,
  assertSettingsPage,
  assertToplistPage,
  assertTorrentsPage,
  assertViewerPage,
} from "../parse/sanity";
import { parseToplist } from "../parse/toplist";
import { parseTorrents } from "../parse/torrents";
import { parseUconfig } from "../parse/uconfig";
import { parseViewer } from "../parse/viewer";
import { documentTitle, SITE_PATHS } from "../site";
import type { GalleryThumb, ListItem } from "../types";
import type { CursorPage, PageSource } from "../ui/page-cursor";
import { renderArchive } from "../views/archive";
import type { ViewContext } from "../views/context";
import { favoritesLabels, renderFavorites } from "../views/favorites";
import { renderGallery } from "../views/gallery";
import { renderGalleryTorrents } from "../views/gallery-torrents";
import { renderHome } from "../views/home";
import { listLabels, renderList } from "../views/list";
import { renderMyTags } from "../views/my-tags";
import { renderNews } from "../views/news";
import { renderSettings } from "../views/settings";
import { renderToplist } from "../views/toplist";
import { renderTorrents } from "../views/torrents";
import { mountViewer } from "../views/viewer";
import {
  ALL_CATEGORY_BITS,
  categoryPathBit,
  GALLERY_PATH,
  isPath,
  SCOPE_PATHS,
  UPLOADER_PATH,
  VIEWER_PATH,
} from "./identity";
import type {
  ListRouteData,
  LoadOptions,
  OwnedKind,
  OwnedRoute,
  PrepareContext,
  PreparedRoute,
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

/** How many recently parsed document routes keep their data for a history move back. */
const ROUTE_DATA_CACHE_LIMIT = 8;

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
  /** Apply this route's paging policy to the append feed. */
  feed?: (route: RouteOf<K>, source: PageSource<I>) => PageSource<I>;
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
  // History moves back to a page the app just rendered should not refetch it. The cap keeps a long
  // session's visits from retaining every parsed document; `fresh` (and an always-fresh spec, such
  // as settings or the archive chooser) still goes to the network.
  const cached = new Map<string, RouteDataByKind[K]>();
  /**
   * Pages a view mutated after they were parsed. The next load must bypass both this cache and the
   * loader's document cache, or the pre-mutation page comes back.
   */
  const stale = new Set<string>();
  const cacheable = spec.fresh !== true;
  const remember = (route: RouteOf<K>, data: RouteDataByKind[K]): void => {
    if (!cacheable) {
      return;
    }
    stale.delete(route.url);
    // Refresh the insertion order so the cap evicts the least recently used page.
    cached.delete(route.url);
    cached.set(route.url, data);
    if (cached.size > ROUTE_DATA_CACHE_LIMIT) {
      const oldest = cached.keys().next().value;
      if (oldest !== undefined) {
        cached.delete(oldest);
      }
    }
  };

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

  const feed = (route: RouteOf<K>): PageSource<I> | undefined => {
    if (pageSource === undefined) {
      return undefined;
    }
    return spec.feed === undefined ? pageSource : spec.feed(route, pageSource);
  };

  return {
    prepare: (route) => ({ route, bootUrl: null, state: {} }),
    load: async (route, signal, options) => {
      const force = options?.fresh === true || stale.has(route.url);
      if (!force) {
        const hit = cached.get(route.url);
        if (hit !== undefined) {
          return hit;
        }
      }
      const { doc, url } = await fetchDocument(
        spec.request?.(route) ?? route.url,
        signal,
        priorityOf("navigation"),
        force ? { fresh: true } : options,
      );
      const data = spec.parse(doc, url, route);
      spec.sanity?.(data, doc);
      remember(route, data);
      return data;
    },
    seed: (route, data) => {
      remember(route, data);
    },
    invalidate: (route) => {
      if (!cacheable) {
        return;
      }
      cached.delete(route.url);
      stale.delete(route.url);
      stale.add(route.url);
      if (stale.size > ROUTE_DATA_CACHE_LIMIT) {
        const oldest = stale.values().next().value;
        if (oldest !== undefined) {
          stale.delete(oldest);
        }
      }
    },
    parse: (doc, route) => {
      const data = spec.parse(doc, route.url, route);
      spec.sanity?.(data, doc);
      return data;
    },
    render: (host, data, ctx, route) => spec.render(host, data, ctx, feed(route)),
    title: (data) => spec.title(data),
    feed,
  };
}

/** The client-side posted-date range a list route carries. */
function listRange(route: RouteOf<"list">): DateRange {
  return { since: route.query.since, until: route.query.until };
}

/**
 * Parse a list page under the route's own date policy: the initial page is bounded and paged links
 * carry the range, so the view never has to re-wrap the feed.
 */
function listRouteData(route: RouteOf<"list">, doc: Document, url: string): ListRouteData {
  const page = parseListPage(doc, url);
  const range = listRange(route);
  if (!isDateRangeActive(range)) {
    return { page, query: route.query, scope: route.scope };
  }
  const filtered = filterByDateRange(page.items, range);
  return {
    page: {
      ...page,
      items: filtered.items,
      nextHref:
        page.nextHref !== null && !filtered.crossedSince
          ? withDateRange(page.nextHref, range)
          : null,
    },
    query: route.query,
    scope: route.scope,
  };
}

/** The list route's append feed: every appended page is bounded and its next link carried. */
function listFeed(route: RouteOf<"list">, source: PageSource<ListItem>): PageSource<ListItem> {
  const range = listRange(route);
  if (!isDateRangeActive(range)) {
    return source;
  }
  return async (url, signal) => {
    const page = await source(withDateRange(url, range), signal);
    const kept = filterByDateRange(page.items, range);
    return {
      items: kept.items,
      next: kept.crossedSince || page.next === null ? null : withDateRange(page.next, range),
    };
  };
}

/**
 * Prepare a listing address: remembered filters fill a bare listing, and a cold load starts the
 * site's cursor at the range's newest day. The browser must first load that effective address;
 * in-app navigation loads it through the row's request translation instead.
 */
function prepareListRoute(
  route: RouteOf<"list">,
  context: PrepareContext,
): PreparedRoute<RouteOf<"list">> {
  const filtered = applyPersistedListFilters(route);
  const requestUrl = listRequestUrl(filtered.url);
  const bootUrl =
    context.previous === null && (filtered.url !== route.url || requestUrl !== filtered.url)
      ? requestUrl
      : null;
  return { route: filtered, bootUrl, state: {} };
}

/**
 * The reader keeps the marker that lets its back action pop the gallery entry instead of opening a
 * paged gallery URL; replace-navigations (next/previous page) preserve the current marker.
 */
function prepareViewerRoute(
  route: RouteOf<"viewer">,
  context: PrepareContext,
): PreparedRoute<RouteOf<"viewer">> {
  const remembered = context.previousState.fromGallery === true;
  const fromGallery = context.replace ? remembered : context.previous?.kind === "gallery";
  return { route, bootUrl: null, state: { fromGallery } };
}

/**
 * Build the route table. Each entry pairs the URL shape that produces its kind with the adapter
 * that renders it; the mapped type makes a missing or mismatched kind a compile error.
 */
export function createRouteViews(deps: RouteViewDeps): RouteViews {
  const table: RouteTable = {
    viewer: {
      match: (url) => (VIEWER_PATH.test(url.pathname) ? { kind: "viewer", url: url.href } : null),
      prepare: prepareViewerRoute,
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
        page: parseGalleryThumbPage,
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
        parse: (doc, url, route) => listRouteData(route, doc, url),
        sanity: (data, doc) => assertListPage(data.page, doc),
        page: (doc, url) => {
          const page = parseListPage(doc, url);
          return { items: page.items, next: page.nextHref };
        },
        feed: listFeed,
        render: (host, data, ctx, pageSource) =>
          renderList(host, data.page, data.query, ctx, data.scope, { pageSource }),
        title: (data) => {
          const pathTag = tagTokenFromHref(new URL(data.page.url).pathname, data.page.url);
          return documentTitle(listLabels(data.query, data.scope, pathTag).title);
        },
      }),
      prepare: prepareListRoute,
    },
    torrents: {
      match: (url) =>
        url.pathname === SITE_PATHS.torrents ? { kind: "torrents", url: url.href } : null,
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
        url.pathname === SITE_PATHS.galleryTorrents
          ? { kind: "galleryTorrents", url: url.href }
          : null,
      ...documentView<"galleryTorrents">(deps, {
        tag: "gallery-torrents",
        parse: parseGalleryTorrents,
        sanity: assertGalleryTorrentsPage,
        render: (host, data, ctx) => renderGalleryTorrents(host, data, ctx),
        title: (data) =>
          documentTitle(data.title === "" ? "Torrents" : `Torrents for ${data.title}`),
      }),
    },
    archive: {
      match: (url) =>
        url.pathname === SITE_PATHS.archive ? { kind: "archive", url: url.href } : null,
      ...documentView<"archive">(deps, {
        tag: "archive",
        parse: parseArchivePage,
        sanity: assertArchivePage,
        render: (host, data, ctx) => renderArchive(host, data, ctx),
        title: () => documentTitle("Archive Download"),
        // An unlocked resample and the printed GP price are server state; a cached chooser can be stale.
        fresh: true,
      }),
    },
    home: {
      match: (url) => (url.pathname === SITE_PATHS.home ? { kind: "home", url: url.href } : null),
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
        isPath(url.pathname, SITE_PATHS.myTags) ? { kind: "myTags", url: url.href } : null,
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
        url.pathname === SITE_PATHS.favorites ? { kind: "favorites", url: url.href } : null,
      ...documentView<"favorites">(deps, {
        tag: "favorites",
        parse: parseFavorites,
        sanity: assertFavoritesPage,
        render: (host, data, ctx) => renderFavorites(host, data, ctx),
        title: (data) => documentTitle(...favoritesLabels(data).title),
      }),
    },
    toplist: {
      match: (url) =>
        url.pathname === SITE_PATHS.toplist ? { kind: "toplist", url: url.href } : null,
      ...documentView<"toplist">(deps, {
        tag: "toplist",
        parse: parseToplist,
        sanity: assertToplistPage,
        render: renderToplist,
        title: (data) =>
          data.kind === "category" ? documentTitle(data.title) : documentTitle("Toplists"),
      }),
    },
    news: {
      match: (url) => (url.pathname === SITE_PATHS.news ? { kind: "news", url: url.href } : null),
      ...documentView<"news">(deps, {
        tag: "news",
        parse: parseNews,
        sanity: assertNewsPage,
        render: (host, data, ctx) => renderNews(host, data, ctx),
        title: () => documentTitle("News"),
      }),
    },
    settings: {
      match: (url) =>
        url.pathname === SITE_PATHS.uconfig ? { kind: "settings", url: url.href } : null,
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

  function viewFor<K extends OwnedKind>(route: RouteOf<K>): RouteViewFor<K>;
  function viewFor(route: Route): RouteView<unknown>;
  function viewFor(route: Route): RouteView<unknown> {
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

  return { routeView: viewFor, match };
}

const productionViews = createRouteViews(loader);

export function routeView(route: Route): RouteView<unknown> {
  return productionViews.routeView(route);
}

/** Production owned-route classifier, used by `parseRoute` after its origin checks. */
export const matchOwnedRoute: RouteViews["match"] = (url: URL) => productionViews.match(url);

export type { RouteOf, RouteView } from "./types";
