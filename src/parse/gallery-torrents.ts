import { anchorHref, cleanText, parseNumber } from "./helpers";
import { galleryHref, queryGalleryIdentity } from "./url";

/** One torrent form from `/gallerytorrents.php`. */
export interface GalleryTorrent {
  /** Hidden field the details POST carries. */
  gtid: string;
  /** File name printed on the tracker download link. */
  name: string;
  posted: string;
  size: string;
  seeds: number;
  peers: number;
  downloads: number;
  uploader: string;
  /** Absolute tracker download URL, or null when the form has no link. */
  downloadHref: string | null;
}

/** Parsed gallery torrent popup: the gallery title and every torrent offered for it. */
export interface GalleryTorrentsPage {
  /** Address this page was loaded from; the details POST targets it. */
  url: string;
  /** Gallery title above the forms; empty when the page has none. */
  title: string;
  /** In-app gallery address, when the page's query names a complete gallery. */
  galleryHref: string | null;
  torrents: readonly GalleryTorrent[];
}

/** The tracker link each form carries; its text is the torrent's file name. */
const DOWNLOAD_LINK = "a[href*='ehtracker.org/get/']";

/** The gallery address the page's `gid`/`t` query names, if both values are safe. */
function galleryHrefFrom(url: string): string | null {
  const identity = queryGalleryIdentity(url, "gid", "t");
  return identity === null ? null : galleryHref(identity);
}

/**
 * Every labelled value in a form, keyed by its label with the value cleaned once.
 *
 * The live page puts the label and value in one table cell (separate spans), so splitting each
 * cell's text on its first colon avoids rescanning the form for every field.
 */
function fieldMap(form: Element): Map<string, string> {
  const fields = new Map<string, string>();
  for (const cell of form.querySelectorAll("td")) {
    const text = cleanText(cell.textContent);
    const colon = text.indexOf(":");
    if (colon <= 0 || fields.has(text.slice(0, colon))) {
      continue;
    }
    fields.set(text.slice(0, colon), cleanText(text.slice(colon + 1)));
  }
  return fields;
}

function parseTorrent(form: Element, base: string): GalleryTorrent | null {
  const gtid = (form.querySelector<HTMLInputElement>("input[name='gtid']")?.value ?? "").trim();
  if (gtid === "") {
    return null;
  }

  const link = form.querySelector(DOWNLOAD_LINK);
  const fields = fieldMap(form);
  return {
    gtid,
    name: cleanText(link?.textContent),
    posted: fields.get("Posted") ?? "",
    size: fields.get("Size") ?? "",
    seeds: parseNumber(fields.get("Seeds")) ?? 0,
    peers: parseNumber(fields.get("Peers")) ?? 0,
    downloads: parseNumber(fields.get("Downloads")) ?? 0,
    uploader: fields.get("Uploader") ?? "",
    downloadHref: anchorHref(link, base),
  };
}

/**
 * Parse a `/gallerytorrents.php` popup.
 *
 * A gallery with no torrents renders the container without forms and with a notice; that case is an
 * empty list here, and `assertGalleryTorrentsPage` checks the notice. This parser never invents
 * rows, so a page whose forms no longer match the layout stays empty for the sanity check to
 * reject.
 */
export function parseGalleryTorrents(doc: Document, url: string): GalleryTorrentsPage {
  const container = doc.getElementById("torrentinfo");
  const torrents: GalleryTorrent[] = [];

  if (container !== null) {
    for (const form of container.querySelectorAll("form")) {
      const torrent = parseTorrent(form, url);
      if (torrent !== null) {
        torrents.push(torrent);
      }
    }
  }

  return {
    url,
    title: cleanText(container?.querySelector("h1")?.textContent),
    galleryHref: galleryHrefFrom(url),
    torrents,
  };
}
