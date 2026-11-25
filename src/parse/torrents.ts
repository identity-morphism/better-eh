import { parsePageRange } from "./gallery";
import { anchorHref, cleanText, parseNumber } from "./helpers";
import { pagerData, pagerTable } from "./pager";
import { galleryGid, safeUrl } from "./url";

/** Status filter the site expresses through the `s` query parameter. */
export type TorrentStatus = "all" | "seeded" | "unseeded";

/** One torrent row from `/torrents.php`. */
export interface TorrentRow {
  gid: string | null;
  name: string;
  /** Native torrent detail/download page the name links to. */
  torrentHref: string | null;
  galleryHref: string | null;
  size: string;
  seeds: number;
  peers: number;
  downloads: number;
  uploader: string | null;
  uploaderHref: string | null;
  added: string;
}

/** Parsed torrent index page. */
export interface TorrentPage {
  /** Address this page was loaded from; the view builds filter and page links from it. */
  url: string;
  rows: readonly TorrentRow[];
  status: TorrentStatus;
  /** Member id from the `u` filter, or null when the index is unfiltered by uploader. */
  uploaderFilter: string | null;
  /** Keyword search from the `search` parameter. */
  search: string;
  /** Column the index is sorted by (`o`), or null for the site's default newest-first order. */
  sort: string | null;
  summary: string | null;
  page: number;
  pages: readonly number[];
  nextHref: string | null;
  prevHref: string | null;
}

function statusFromUrl(url: URL | null): TorrentStatus {
  const status = url?.searchParams.get("s");
  if (status === "seeded" || status === "unseeded") {
    return status;
  }
  return "all";
}

function pageFromUrl(url: URL | null): number {
  const raw = url?.searchParams.get("page");
  if (raw === null || raw === undefined) {
    return 1;
  }
  const zeroBased = Number.parseInt(raw, 10);
  return Number.isInteger(zeroBased) && zeroBased > 0 ? zeroBased + 1 : 1;
}

function parseSummary(doc: Document): string | null {
  for (const node of doc.querySelectorAll("p.ip")) {
    const text = cleanText(node.textContent);
    if (parsePageRange(text) === null) {
      continue;
    }
    return text;
  }
  return null;
}

function parseRow(row: Element, base: string): TorrentRow | null {
  let addedCell: Element | undefined;
  let nameCell: Element | undefined;
  let galleryCell: Element | undefined;
  let sizeCell: Element | undefined;
  let seedsCell: Element | undefined;
  let peersCell: Element | undefined;
  let downloadsCell: Element | undefined;
  let uploaderCell: Element | undefined;
  let index = 0;
  for (const child of row.children) {
    if (!child.classList.contains("itd")) {
      continue;
    }
    switch (index) {
      case 0:
        addedCell = child;
        break;
      case 1:
        nameCell = child;
        break;
      case 2:
        galleryCell = child;
        break;
      case 3:
        sizeCell = child;
        break;
      case 4:
        seedsCell = child;
        break;
      case 5:
        peersCell = child;
        break;
      case 6:
        downloadsCell = child;
        break;
      case 7:
        uploaderCell = child;
        break;
      default:
        break;
    }
    index++;
    if (index > 7) {
      break;
    }
  }
  if (
    !addedCell ||
    !nameCell ||
    !galleryCell ||
    !sizeCell ||
    !seedsCell ||
    !peersCell ||
    !downloadsCell ||
    !uploaderCell
  ) {
    return null;
  }

  const nameAnchor = nameCell.querySelector("a");
  const name = cleanText(nameAnchor?.textContent) || cleanText(nameCell.textContent);
  if (!name) {
    return null;
  }

  const galleryHref = anchorHref(galleryCell.querySelector("a"), base);
  const rowId = row.getAttribute("id");
  const uploaderLink = uploaderCell.querySelector("a");

  return {
    gid: galleryGid(galleryHref) ?? (rowId !== null && /^\d+$/.test(rowId) ? rowId : null),
    name,
    torrentHref: anchorHref(nameAnchor, base),
    galleryHref,
    size: cleanText(sizeCell.textContent),
    seeds: parseNumber(seedsCell.textContent) ?? 0,
    peers: parseNumber(peersCell.textContent) ?? 0,
    downloads: parseNumber(downloadsCell.textContent) ?? 0,
    uploader: cleanText(uploaderLink?.textContent) || cleanText(uploaderCell.textContent) || null,
    uploaderHref: anchorHref(uploaderLink, base),
    added: cleanText(addedCell.textContent),
  };
}

/**
 * Parse a `/torrents.php` page.
 *
 * The URL is the authority for the filters: `s` carries the status and `u` carries the uploader
 * filter (your own member id for "Only My Torrents", anyone else's for their uploader filter).
 * Pagination is adapted from the site's own pager, where `?page=N` is a zero-based page index.
 */
export function parseTorrents(doc: Document, url: string): TorrentPage {
  const parsedUrl = safeUrl(url);
  const pager = pagerTable(doc);

  const rows: TorrentRow[] = [];
  for (const row of doc.querySelectorAll("table.itg tr")) {
    const parsedRow = parseRow(row, url);
    if (parsedRow) {
      rows.push(parsedRow);
    }
  }

  const summary = parseSummary(doc);

  const uploader = parsedUrl?.searchParams.get("u")?.trim() ?? "";
  const paging = pagerData(pager, url);

  return {
    url,
    rows,
    status: statusFromUrl(parsedUrl),
    uploaderFilter: uploader === "" ? null : uploader,
    search: parsedUrl?.searchParams.get("search")?.trim() ?? "",
    sort: parsedUrl?.searchParams.get("o")?.trim() || null,
    summary,
    page: pageFromUrl(parsedUrl),
    pages: paging.pages,
    prevHref: paging.prevHref,
    nextHref: paging.nextHref,
  };
}
