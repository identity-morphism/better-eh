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
