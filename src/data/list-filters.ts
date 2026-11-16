import { isRecord } from "../guards";
import type { SearchFilters, SearchQuery } from "../parse/query";
import { emptySearchFilters, parseSearchQuery, writeSearchFilters } from "../parse/query";
import { categoryPathBit } from "../routes/identity";
import type { Route } from "../routes/types";
import { createStore, gmStorage } from "../store";

const KEY = "eh:list-filters:v1";
const PANEL_KEY = "eh:list-filters-open:v1";
const VERSION = 1;

/** URL parameters that mean the address already chose its own filters. */
const FILTER_PARAMS = [
  "f_cats",
  "f_srdd",
  "f_sh",
  "f_sto",
  "f_spf",
  "f_spt",
  "f_sfl",
  "f_sfu",
  "f_sft",
] as const;

function isStoredFilters(value: unknown): value is Partial<SearchFilters> {
  return isRecord(value);
}

const filters = createStore<Partial<SearchFilters>>(
  { key: KEY, version: VERSION, empty: () => ({}), guard: isStoredFilters },
  gmStorage(),
);

const panel = createStore<boolean>(
  {
    key: PANEL_KEY,
    version: VERSION,
    empty: () => false,
    guard: (value): value is boolean => typeof value === "boolean",
  },
  gmStorage(),
);

/** The saved filters, or empty filters when nothing has been stored yet. */
function getListFilters(): SearchFilters {
  return { ...emptySearchFilters(), ...filters.read() };
}

/** Remember the filters the user just applied, so a bare listing shows them next session. */
export function saveListFilters(query: SearchQuery): void {
  // Spreading the query carries its free text too, which the filter writer ignores.
  filters.write({ ...emptySearchFilters(), ...query } satisfies SearchFilters);
}

/** Whether the filter panel is expanded; persisted so it reopens the same way. */
export function isListPanelOpen(): boolean {
  return panel.read();
}

export function setListPanelOpen(open: boolean): void {
  panel.write(open);
}

function hasFilters(prefs: SearchFilters): boolean {
  const params = new URLSearchParams();
  writeSearchFilters(params, prefs);
  return params.toString() !== "";
}

/**
 * Add remembered filters to a listing address that did not choose any of its own.
 *
 * An explicit filter parameter or a category path (`/doujinshi`) always wins; a bare address (`/`,
 * a tag page, an uploader page, pagination links) inherits the remembered set. The route's URL and
 * query are rebuilt together, so callers never re-parse the patched address.
 */
export function applyPersistedListFilters(route: Route): Route {
  if (route.kind !== "list" || (route.scope !== "search" && route.scope !== "uploader")) {
    return route;
  }
  const url = new URL(route.url);
  const pathBit = categoryPathBit(url.pathname);
  if (pathBit !== null && pathBit !== 0) {
    return route;
  }
  if (FILTER_PARAMS.some((name) => url.searchParams.has(name))) {
    return route;
  }
  const prefs = getListFilters();
  if (!hasFilters(prefs)) {
    return route;
  }
  writeSearchFilters(url.searchParams, prefs);
  return {
    ...route,
    url: url.href,
    // Keep the uploader's derived search token: the address does not carry it.
    query: { ...parseSearchQuery(url), text: route.query.text },
  };
}
