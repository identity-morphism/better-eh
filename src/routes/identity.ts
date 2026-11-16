import { CATEGORIES } from "../parse/query";
import type { ListScope } from "./types";

/** A gallery page: `/g/<gid>/<token>/`, the strict shape the gallery route owns. */
export { GALLERY_PATH } from "../parse/url";

/** A viewer page: `/s/<hash>/<gid>-<n>`. */
export const VIEWER_PATH = /^\/s\/[^/]+\/\d+-\d+\/?$/;

/** An uploader listing: `/uploader/<name>`. */
export const UPLOADER_PATH = /^\/uploader\/[^/]+\/?$/;

/** Listing paths and the single category each one shows; `/` is the unfiltered index. */
const LIST_PATHS: Record<string, number> = {
  "/": 0,
  "/doujinshi": 2,
  "/manga": 4,
  "/artistcg": 8,
  "/gamecg": 16,
  "/western": 512,
  "/non-h": 256,
  "/imageset": 32,
  "/cosplay": 64,
  "/asianporn": 128,
  "/misc": 1,
};

/** Every category bit, so a category path can exclude just its own category. */
export const ALL_CATEGORY_BITS = CATEGORIES.reduce((bits, category) => bits | category.bit, 0);

/** The single category bit a listing path shows, or null when the path is not a category listing. */
export function categoryPathBit(pathname: string): number | null {
  return LIST_PATHS[pathname] ?? null;
}

/** Listing routes whose table is the front-page table under a different heading. */
export const SCOPE_PATHS: Record<string, ListScope> = {
  "/popular": "popular",
  "/watched": "watched",
};

/** The same address without the reader, so the site can render it natively. */
export function nativeUrl(href: string = location.href): string {
  const url = new URL(href);
  url.searchParams.set("eh_native", "1");
  return url.href;
}
