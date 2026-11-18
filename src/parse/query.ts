import { formatTagToken } from "../tags/model";
import { safeUrl } from "./url";

export interface Category {
  bit: number;
  name: string;
  cls: string;
}

export const CATEGORIES: readonly Category[] = [
  { bit: 2, name: "Doujinshi", cls: "ct2" },
  { bit: 4, name: "Manga", cls: "ct3" },
  { bit: 8, name: "Artist CG", cls: "ct4" },
  { bit: 16, name: "Game CG", cls: "ct5" },
  { bit: 512, name: "Western", cls: "cta" },
  { bit: 256, name: "Non-H", cls: "ct9" },
  { bit: 32, name: "Image Set", cls: "ct6" },
  { bit: 64, name: "Cosplay", cls: "ct7" },
  { bit: 128, name: "Asian Porn", cls: "ct8" },
  { bit: 1, name: "Misc", cls: "ct1" },
];

/** Name of the only enabled category, or null when none or several are enabled. */
export function singleCategoryName(cats: number): string | null {
  const enabled = CATEGORIES.filter((category) => (cats & category.bit) === 0);
  return enabled.length === 1 ? (enabled[0]?.name ?? null) : null;
}

/** Listing filters, carried in the address and in the remembered filter set. */
export interface SearchFilters {
  cats: number;
  rating: number;
  expunged: boolean;
  torrent: boolean;
  pageFrom: string;
  pageTo: string;
  /** App-owned posted-date range; `YYYY-MM-DD` or empty for no bound. */
  since: string;
  until: string;
  disableLanguage: boolean;
  disableUploader: boolean;
  disableTags: boolean;
}

export interface SearchQuery extends SearchFilters {
  text: string;
}

/** The filter half of a query with every filter off, matching a bare gallery index page. */
export function emptySearchFilters(): SearchFilters {
  return {
    cats: 0,
    rating: 0,
    expunged: false,
    torrent: false,
    pageFrom: "",
    pageTo: "",
    since: "",
    until: "",
    disableLanguage: false,
    disableUploader: false,
    disableTags: false,
  };
}

/** An empty query, matching a bare gallery index page. */
export function emptySearchQuery(): SearchQuery {
  return { text: "", ...emptySearchFilters() };
}

export function parseSearchQuery(url: URL): SearchQuery {
  const params = url.searchParams;
  return {
    text: params.get("f_search") ?? "",
    cats: Number.parseInt(params.get("f_cats") ?? "0", 10) || 0,
    rating: Number.parseInt(params.get("f_srdd") ?? "0", 10) || 0,
    expunged: params.has("f_sh"),
    torrent: params.has("f_sto"),
    pageFrom: params.get("f_spf") ?? "",
    pageTo: params.get("f_spt") ?? "",
    since: params.get("eh_since") ?? "",
    until: params.get("eh_until") ?? "",
    disableLanguage: params.has("f_sfl"),
    disableUploader: params.has("f_sfu"),
    disableTags: params.has("f_sft"),
  };
}

/** Whether any filter beyond the free-text query and category bits is active. */
function hasAdvancedFilters(query: SearchFilters): boolean {
  return (
    query.rating > 0 ||
    query.expunged ||
    query.torrent ||
    query.pageFrom.trim() !== "" ||
    query.pageTo.trim() !== "" ||
    query.since.trim() !== "" ||
    query.until.trim() !== "" ||
    query.disableLanguage ||
    query.disableUploader ||
    query.disableTags
  );
}

/** Write the filter part of a query using the site's own parameter names. */
export function writeSearchFilters(params: URLSearchParams, query: SearchFilters): void {
  if (query.cats !== 0) {
    params.set("f_cats", String(query.cats));
  }
  if (query.rating > 0) {
    params.set("f_srdd", String(query.rating));
  }
  if (query.expunged) {
    params.set("f_sh", "on");
  }
  if (query.torrent) {
    params.set("f_sto", "on");
  }
  const pageFrom = query.pageFrom.trim();
  if (pageFrom) {
    params.set("f_spf", pageFrom);
  }
  const pageTo = query.pageTo.trim();
  if (pageTo) {
    params.set("f_spt", pageTo);
  }
  const since = query.since.trim();
  if (since) {
    params.set("eh_since", since);
  }
  const until = query.until.trim();
  if (until) {
    params.set("eh_until", until);
  }
  if (query.disableLanguage) {
    params.set("f_sfl", "on");
  }
  if (query.disableUploader) {
    params.set("f_sfu", "on");
  }
  if (query.disableTags) {
    params.set("f_sft", "on");
  }
  if (hasAdvancedFilters(query)) {
    params.set("advsearch", "1");
  }
}

/** Build a search URL from the same query shape the UI edits. */
export function buildSearchUrl(query: SearchQuery): string {
  const params = new URLSearchParams();
  const text = query.text.trim();

  if (text) {
    params.set("f_search", text);
  }
  writeSearchFilters(params, query);

  const search = params.toString();
  return search ? `/?${search}` : "/";
}

export function categoryFromClass(cls: string | null | undefined): Category | null {
  if (!cls) {
    return null;
  }
  return CATEGORIES.find((category) => category.cls === cls) ?? null;
}

/** Convert an EH tag URL into an exact-match `f_search` token. */
export function tagTokenFromHref(href: string, base: string | URL): string | null {
  const url = safeUrl(href, base);
  return url ? tagTokenFromUrl(url) : null;
}

/**
 * Convert an uploader URL (`/uploader/<name>`) into the `uploader:` search token, using the same
 * exact-match serializer as tag links.
 */
export function uploaderTokenFromHref(href: string, base: string | URL): string | null {
  const url = safeUrl(href, base);
  return url ? uploaderTokenFromUrl(url) : null;
}

function tagTokenFromUrl(url: URL): string | null {
  const match = /^\/tag\/([^:]+):(.+)$/.exec(url.pathname);
  if (!match) {
    return null;
  }

  const namespace = match[1] ?? "";
  let value: string;
  try {
    value = decodeURIComponent((match[2] ?? "").replace(/\+/g, " ")).trim();
  } catch {
    // `URL.pathname` keeps malformed escapes (`%ZZ`, a bare `%`); they are not a tag.
    return null;
  }
  if (!value) {
    return null;
  }

  return formatTagToken(namespace, value);
}

function uploaderTokenFromUrl(url: URL): string | null {
  const match = /^\/uploader\/([^/]+)\/?$/.exec(url.pathname);
  if (!match?.[1]) {
    return null;
  }

  let name: string;
  try {
    name = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
  } catch {
    return null;
  }
  if (!name) {
    return null;
  }

  return formatTagToken("uploader", name);
}
