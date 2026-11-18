/** The two domains the script runs on; the API lives on a subdomain of each. */
const SITE_DOMAINS = ["e-hentai.org", "exhentai.org"] as const;

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
