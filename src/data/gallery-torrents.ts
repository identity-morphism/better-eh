import { postForm } from "../net/http";
import { anchorHref, cleanText, parseNumber } from "../parse/helpers";

/** The details view the site answers a torrent-info POST with. */
export interface TorrentInfo {
  name: string;
  posted: string;
  size: string;
  seeds: number;
  /** Leechers currently connected; the site labels this row `DLers`. */
  peers: number;
  /** Finished downloads, labelled `Completes` on the page. */
  completes: number;
  uploader: string;
  /** Tracker link that records the reader's stats; null when the page does not offer one. */
  personalizedHref: string | null;
  /** Tracker link safe to hand to other people. */
  redistributableHref: string | null;
  /** The torrent's own comment block, collapsed to one line; empty when there is none. */
  comments: string;
}

/** Pair each label cell of the `#ett` table with the value cell that follows it. */
function fieldPairs(table: Element): Map<string, string> {
  const fields = new Map<string, string>();
  for (const row of table.querySelectorAll("tr")) {
    const cells = [...row.children].filter((cell) => cell.tagName === "TD");
    for (let index = 0; index + 1 < cells.length; index += 2) {
      const label = cleanText(cells[index]?.textContent).toLowerCase();
      if (label !== "") {
        fields.set(label, cleanText(cells[index + 1]?.textContent));
      }
    }
  }
  return fields;
}

/** The first anchor under `root` whose text matches `label`. */
function labeledHref(root: Element, label: RegExp, base: string): string | null {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (label.test(cleanText(anchor.textContent))) {
      const href = anchorHref(anchor, base);
      if (href !== null) {
        return href;
      }
    }
  }
  return null;
}

/**
 * Parse the details page a torrent-info POST returns.
 *
 * Null means the response carried no info block at all (the site answers an unknown torrent with
 * the index or a notice); a block missing an individual field still yields a row with empty fields,
 * because partial data beats hiding the whole torrent.
 */
export function parseTorrentInfo(doc: Document, base: string): TorrentInfo | null {
  const container = doc.getElementById("torrentinfo");
  const table = container?.querySelector("#ett") ?? null;
  if (container === null || table === null) {
    return null;
  }

  const fields = fieldPairs(table);
  return {
    name: cleanText(container.querySelector("h1")?.textContent),
    posted: fields.get("posted") ?? "",
    size: fields.get("size") ?? "",
    seeds: parseNumber(fields.get("seeds")) ?? 0,
    peers: parseNumber(fields.get("dlers")) ?? 0,
    completes: parseNumber(fields.get("completes")) ?? 0,
    uploader: fields.get("uploader") ?? "",
    personalizedHref: labeledHref(container, /personalized/iu, base),
    redistributableHref: labeledHref(container, /redistributable/iu, base),
    comments: cleanText(container.querySelector("#etd")?.textContent),
  };
}

/**
 * Fetch one torrent's details through the page's own form.
 *
 * The response is an HTML fragment when it is the details view, so it is parsed with `DOMParser`
 * rather than the page loader (which expects a full document and caches by URL).
 */
export async function loadTorrentInfo(
  pageUrl: string,
  gtid: string,
  signal?: AbortSignal,
): Promise<TorrentInfo> {
  const response = await postForm(
    pageUrl,
    new URLSearchParams({ gtid, torrent_info: "Information" }),
    {
      tag: "gallery-torrents",
      failure: "Torrent information request failed",
      signal,
    },
  );
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const info = parseTorrentInfo(doc, pageUrl);
  if (info === null) {
    throw new Error("The torrent information could not be read.");
  }
  return info;
}
