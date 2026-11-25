import { CATEGORIES } from "../parse/query";
import { POPULAR_PATH, WATCHED_PATH } from "../site";
import type { ListScope } from "./types";

/** A gallery page: `/g/<gid>/<token>/`, the strict shape the gallery route owns. */
export { GALLERY_PATH } from "../parse/url";

/** A viewer page: `/s/<hash>/<gid>-<n>`. */
export const VIEWER_PATH = /^\/s\/[^/]+\/\d+-\d+\/?$/;

/** An uploader listing: `/uploader/<name>`. */
export const UPLOADER_PATH = /^\/uploader\/[^/]+\/?$/;

/** Whether `pathname` names `path`, ignoring one trailing slash. */
export function isPath(pathname: string, path: string): boolean {
  return pathname === path || pathname === `${path}/`;
}

/** Listing paths and the single category each one shows; `/` is the unfiltered index. */
const LIST_PATHS: Readonly<Record<string, number>> = {
  "/": 0,
  ...Object.fromEntries(CATEGORIES.map((category) => [category.path, category.bit])),
};

/** Every category bit, so a category path can exclude just its own category. */
export const ALL_CATEGORY_BITS = CATEGORIES.reduce((bits, category) => bits | category.bit, 0);

/** The single category bit a listing path shows, or null when the path is not a category listing. */
export function categoryPathBit(pathname: string): number | null {
  return LIST_PATHS[pathname] ?? null;
}

/** Listing routes whose table is the front-page table under a different heading. */
export const SCOPE_PATHS: Record<string, ListScope> = {
  [POPULAR_PATH]: "popular",
  [WATCHED_PATH]: "watched",
};

/** The same address without the reader, so the site can render it natively. */
export function nativeUrl(href: string = location.href): string {
  const url = new URL(href);
  url.searchParams.set("eh_native", "1");
  return url.href;
}

/** A relative site path carrying the native marker. */
export function nativePath(path: string): string {
  const url = new URL(path, location.origin);
  url.searchParams.set("eh_native", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
