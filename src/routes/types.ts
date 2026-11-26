import type { DocumentOptions, PageLoader } from "../fetch/loader";
import type { ArchivePage } from "../parse/archive";
import type { FavoritesPage } from "../parse/favorites";
import type { GalleryTorrentsPage } from "../parse/gallery-torrents";
import type { HomePage } from "../parse/home";
import type { MyTagsPage } from "../parse/my-tags";
import type { SearchQuery } from "../parse/query";
import type { ToplistPage } from "../parse/toplist";
import type { TorrentPage } from "../parse/torrents";
import type { UconfigSection } from "../parse/uconfig";
import type { GalleryData, ListPageData, PageData } from "../types";
import type { PageSource } from "../ui/page-cursor";
import type { ViewContext } from "../views/context";

/** The listing tab a list route renders: the query's own table or one of the site's variants. */
export type ListScope = "search" | "popular" | "watched" | "uploader";

/** An owned URL classified by `parseRoute`; every other address is `native`. */
export type Route =
  | { kind: "viewer"; url: string }
  | { kind: "gallery"; url: string }
  | { kind: "list"; url: string; query: SearchQuery; scope: ListScope }
  | { kind: "torrents"; url: string }
  | { kind: "favorites"; url: string }
  | { kind: "toplist"; url: string }
  | { kind: "galleryTorrents"; url: string }
  | { kind: "archive"; url: string }
  | { kind: "home"; url: string }
  | { kind: "myTags"; url: string }
  | { kind: "settings"; url: string }
  | { kind: "native"; url: string };

/** Options a route load may receive from the shell: only a cache bypass. */
export type LoadOptions = Pick<DocumentOptions, "fresh">;

/** The entry point a route is prepared from: a cold boot or a history/navigation move. */
export interface PrepareContext {
  /** The route currently mounted, or null during boot. */
  readonly previous: Route | null;
  /** True when the navigation replaces the current entry instead of pushing a new one. */
  readonly replace: boolean;
  /** The current history entry's state, for markers that must survive a replace-navigation. */
  readonly previousState: Readonly<Record<string, unknown>>;
}

/** A route as the shell should address it. */
export interface PreparedRoute<R extends Route> {
  readonly route: R;
  /**
   * Address the browser must load before this route can render from the current document, or null
   * when the document is usable. Boot redirects there instead of rendering the wrong document.
   */
  readonly bootUrl: string | null;
  /** Extra history state for a newly pushed entry. */
  readonly state: Readonly<Record<string, unknown>>;
}

/** One adapter per owned route kind: prepare its address, load, parse, render and title it. */
export interface RouteView<D, R extends Route = Route> {
  /**
   * Apply the row's own address policy before an entry point uses the route: persisted filters, a
   * request-only redirect, per-route history markers. Every shell path crosses this seam, so the
   * shell never names a kind.
   */
  prepare(route: R, context: PrepareContext): PreparedRoute<R>;
  load(route: R, signal: AbortSignal, options?: LoadOptions): Promise<D>;
  parse(doc: Document, route: R): D;
  render(host: HTMLElement, data: D, ctx: ViewContext, route: R): void;
  title(data: D): string;
  /**
   * Keep the data parsed from the entry document so a history move back to it does not refetch a
   * page the app already has; `load` serves it until the caller asks for a fresh load.
   */
  seed?(route: R, data: D): void;
  /**
   * Drop the cached parse for this route so the next visit fetches it again. A mutation changes
   * server state that the cached page still shows; a view calls this through the shell context.
   */
  invalidate?(route: R): void;
  /**
   * The append feed for this route, after the row's own paging policy (e.g. a client-side date
   * range). Absent on routes that do not paginate.
   */
  feed?(route: R): PageSource<unknown> | undefined;
}

/** The data a list route carries: the parsed page plus the query it was loaded for. */
export interface ListRouteData {
  page: ListPageData;
  query: SearchQuery;
  /** Which listing tab produced the page, for headings and titles. */
  scope: ListScope;
}

/** Loaders an adapter needs; tests inject fakes, production passes the page loader. */
export type RouteViewDeps = Pick<PageLoader, "document" | "viewerPage" | "seedViewerPage">;

export type OwnedRoute = Exclude<Route, { kind: "native" }>;
export type OwnedKind = OwnedRoute["kind"];

export type RouteOf<K extends OwnedKind> = Extract<OwnedRoute, { kind: K }>;

export interface RouteDataByKind {
  viewer: PageData;
  gallery: GalleryData;
  list: ListRouteData;
  torrents: TorrentPage;
  favorites: FavoritesPage;
  toplist: ToplistPage;
  galleryTorrents: GalleryTorrentsPage;
  archive: ArchivePage;
  home: HomePage;
  myTags: MyTagsPage;
  settings: readonly UconfigSection[];
}

export type RouteViewFor<K extends OwnedKind> = RouteView<RouteDataByKind[K], RouteOf<K>>;

/**
 * One owned kind's declaration: the URL shape that produces the route and the adapter that renders
 * it. Pairing both halves here is what keeps a matcher from drifting from its adapter.
 */
type RouteEntryFor<K extends OwnedKind> = RouteViewFor<K> & {
  /** Classify a same-origin URL as this kind, or null when another kind owns it. */
  match(url: URL): RouteOf<K> | null;
};

/** The route table: one entry per owned kind, so a new kind cannot omit either half. */
export type RouteTable = { [K in OwnedKind]: RouteEntryFor<K> };
