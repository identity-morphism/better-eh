/** The two domains the script runs on; the API lives on a subdomain of each. */
const SITE_DOMAINS = ["e-hentai.org", "exhentai.org"] as const;

/** Site pages the app owns; every matcher, link and POST target names these constants. */
export const SITE_PATHS = {
  home: "/home.php",
  favorites: "/favorites.php",
  uconfig: "/uconfig.php",
  myTags: "/mytags",
  torrents: "/torrents.php",
  galleryTorrents: "/gallerytorrents.php",
  archive: "/archiver.php",
  toplist: "/toplist.php",
} as const;

/** The unfiltered front page. */
export const FRONT_PATH = "/";

/** Listing paths whose table is the front page under a different heading. */
export const POPULAR_PATH = "/popular";
export const WATCHED_PATH = "/watched";

/** True when `hostname` belongs to the site this tab is on, subdomains included. */
export function isSiteHost(hostname: string): boolean {
  return SITE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** Display name of the host this tab is on, for document titles. */
export function siteLabel(): string {
  if (typeof location === "undefined") {
    return "E-Hentai";
  }
  return /(^|\.)exhentai\.org$/i.test(location.hostname) ? "ExHentai" : "E-Hentai";
}

/** Join a page's title parts and the site name with one separator. */
export function documentTitle(...parts: string[]): string {
  return [...parts, siteLabel()].filter((part) => part !== "").join(" - ");
}

/** Absolute address of a site page on the tab's own origin. */
export function siteUrl(path: string): string {
  return new URL(path, location.origin).href;
}

/**
 * The site's per-gallery popup for `act` (`addfav`, `rename`, …).
 *
 * `base` is the site root the popup hangs off; the gallery page may declare it inline.
 */
export function galleryPopupUrl(
  gid: string,
  token: string,
  act: string,
  base: string | URL = location.origin,
): string {
  const url = new URL("gallerypopups.php", base);
  url.searchParams.set("gid", gid);
  url.searchParams.set("t", token);
  url.searchParams.set("act", act);
  return url.href;
}
