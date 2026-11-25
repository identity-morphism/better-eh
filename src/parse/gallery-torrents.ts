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
 * One labelled value from a form, e.g. `Posted: 2026-11-18 08:17`.
 *
 * The live page puts the label and value in one table cell (separate spans), so reading the cell
 * text is steadier than pairing child nodes.
 */
function fieldText(form: Element, label: string): string {
  const prefix = `${label}:`;
  for (const cell of form.querySelectorAll("td")) {
    const text = cleanText(cell.textContent);
    if (text.startsWith(prefix)) {
      return cleanText(text.slice(prefix.length));
    }
  }
  return "";
}

function parseTorrent(form: Element, base: string): GalleryTorrent | null {
  const gtid = (form.querySelector<HTMLInputElement>("input[name='gtid']")?.value ?? "").trim();
  if (gtid === "") {
    return null;
  }

  const link = form.querySelector(DOWNLOAD_LINK);
  return {
    gtid,
    name: cleanText(link?.textContent),
    posted: fieldText(form, "Posted"),
    size: fieldText(form, "Size"),
    seeds: parseNumber(fieldText(form, "Seeds")) ?? 0,
    peers: parseNumber(fieldText(form, "Peers")) ?? 0,
    downloads: parseNumber(fieldText(form, "Downloads")) ?? 0,
    uploader: fieldText(form, "Uploader"),
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
