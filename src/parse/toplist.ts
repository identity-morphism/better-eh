import { SITE_PATHS } from "../site";
import { anchorHref, cleanText, parseNumber } from "./helpers";
import { parseListPage } from "./list";
import { pagerArrows, pagerCurrent, pagerPages, pagerTable } from "./pager";
import { galleryIdentity, safeUrl } from "./url";

export interface ToplistTab {
  label: string;
  href: string;
  group: string;
  active: boolean;
}

export interface ToplistEntry {
  rank: number;
  label: string;
  href: string | null;
  gid: string | null;
  /** Secondary metric shown after the rank: view count on gallery lists, score on user lists. */
  score: string | null;
  /** Gallery rows carry the same metadata the result cards show; user rows leave these null. */
  uploader: string | null;
  uploaderHref: string | null;
  posted: string;
  pages: number | null;
  category: { name: string; cls: string } | null;
  torrentsHref: string | null;
}

export interface ToplistSection {
  title: string;
  entries: readonly ToplistEntry[];
}

/** Numeric pagination of one category list (`?tl=N&p=N`). */
interface ToplistPager {
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
}

/** `/toplist.php` itself: every category and period as a block of top ten entries. */
export interface ToplistOverview {
  kind: "overview";
  tabs: readonly ToplistTab[];
  sections: readonly ToplistSection[];
}

/** `/toplist.php?tl=N`: a single ranked category list. */
export interface ToplistCategory {
  kind: "category";
  /** Address this page was loaded from; the view builds page links from it. */
  url: string;
  tabs: readonly ToplistTab[];
  title: string;
  entries: readonly ToplistEntry[];
  pager: ToplistPager | null;
}

export type ToplistPage = ToplistOverview | ToplistCategory;

/** The seven ranked categories and the tens digit of their `tl` values. */
const CATEGORIES: ReadonlyArray<{ base: number; name: string }> = [
  { base: 10, name: "Galleries" },
  { base: 20, name: "Uploader" },
  { base: 30, name: "Tagging" },
  { base: 40, name: "Hentai@Home" },
  { base: 50, name: "EHTracker" },
  { base: 60, name: "Cleanup" },
  { base: 70, name: "Rating & Reviewing" },
];

/** Periods in page order: `tl` values end in 1, 2, 3 or 5. */
const PERIODS: ReadonlyArray<{ digit: string; name: string }> = [
  { digit: "1", name: "All-Time" },
  { digit: "2", name: "Past Year" },
  { digit: "3", name: "Past Month" },
  { digit: "5", name: "Yesterday" },
];

interface TabSource {
  key: string;
  href: string;
  label: string;
}

function periodFor(key: string, label: string): string {
  const digit = key.slice(-1);
  const byDigit = PERIODS.find((period) => period.digit === digit);
  if (byDigit) {
    return byDigit.name;
  }
  return PERIODS.find((period) => label.endsWith(period.name))?.name ?? "";
}

function labelFor(rawLabel: string, period: string): string {
  if (period !== "" && rawLabel.endsWith(period)) {
    const stripped = cleanText(rawLabel.slice(0, -period.length));
    if (stripped !== "") {
      return stripped;
    }
  }
  return rawLabel;
}

/** The `tl` value of a URL, or null when it is absent or unparsable. */
function toplistKey(url: string | null): string | null {
  return url === null ? null : (safeUrl(url)?.searchParams.get("tl") ?? null);
}

function buildTabs(sources: readonly TabSource[], requested: string | null): ToplistTab[] {
  const seen = new Set<string>();
  const tabs: ToplistTab[] = [];

  for (const source of sources) {
    if (seen.has(source.key)) {
      continue;
    }
    seen.add(source.key);
    const group = periodFor(source.key, source.label);
    tabs.push({
      label: labelFor(source.label, group),
      href: source.href,
      group,
      active: source.key === requested,
    });
  }

  return tabs;
}

/** The full toplist catalogue, for category pages that link only their own list. */
function catalogueSources(url: string): TabSource[] {
  const base = safeUrl(url);
  const sources: TabSource[] = [];
  for (const category of CATEGORIES) {
    for (const period of PERIODS) {
      const key = String(category.base + Number.parseInt(period.digit, 10));
      const path = `${SITE_PATHS.toplist}?tl=${key}`;
      sources.push({
        key,
        href: base ? new URL(path, base).href : path,
        label: `${category.name} ${period.name}`,
      });
    }
  }
  return sources;
}

interface Metric {
  rank: number;
  score: string | null;
}

/** Rank and score/view count per gallery id, from the leading cell of each results row. */
function galleryMetrics(doc: Document, url: string): Map<string, Metric> {
  const metrics = new Map<string, Metric>();

  for (const row of doc.querySelectorAll("table.itg tr")) {
    const gid = galleryIdentity(anchorHref(row.querySelector("a[href*='/g/']"), url))?.gid;
    const cell = row.querySelector("td");
    if (!gid || !cell) {
      continue;
    }
    const lines = [...cell.querySelectorAll("p")].map((line) => cleanText(line.textContent));
    metrics.set(gid, {
      rank: parseNumber(lines[0]) ?? metrics.size + 1,
      score: lines[1] || null,
    });
  }

  return metrics;
}

/** Gallery rows: reuse the results-table parser, then attach each row's toplist rank. */
function galleryEntries(doc: Document, url: string): ToplistEntry[] {
  const page = parseListPage(doc, url);
  const metrics = galleryMetrics(doc, url);

  return page.items.map((item, index) => {
    const metric = metrics.get(item.gid);
    return {
      rank: metric?.rank ?? index + 1,
      label: item.title.primary,
      href: item.href,
      gid: item.gid,
      score: metric?.score ?? null,
      uploader: item.uploader,
      uploaderHref: item.uploaderHref,
      posted: item.posted,
      pages: item.pages,
      category: item.category,
      torrentsHref: item.torrentsHref,
    };
  });
}

/** User rows: two rank/score/name triplets per row on uploader-style lists. */
function userEntries(doc: Document, url: string): ToplistEntry[] {
  const entries: ToplistEntry[] = [];

  for (const row of doc.querySelectorAll("table.itg tr")) {
    const ranks = [...row.querySelectorAll("td.dr")];
    const scores = [...row.querySelectorAll("td.ds")];
    const links = [...row.querySelectorAll("td.du a[href]")];

    for (const [index, cell] of ranks.entries()) {
      const rank = parseNumber(cell.textContent);
      if (rank === null) {
        continue;
      }
      const anchor = links[index];
      entries.push({
        rank,
        label: cleanText(anchor?.textContent) || cleanText(cell.textContent),
        href: anchorHref(anchor ?? null, url),
        gid: null,
        score: cleanText(scores[index]?.textContent) || null,
        uploader: null,
        uploaderHref: null,
        posted: "",
        pages: null,
        category: null,
        torrentsHref: null,
      });
    }
  }

  return entries.sort((a, b) => a.rank - b.rank);
}

function parsePager(doc: Document, url: string): ToplistPager | null {
  const table = pagerTable(doc);
  if (!table) {
    return null;
  }
  return {
    page: pagerCurrent(table) ?? 1,
    pages: pagerPages(table).reduce((max, page) => Math.max(max, page), 1),
    ...pagerArrows(table, url),
  };
}

function parseEntries(block: Element, url: string): ToplistEntry[] {
  const entries: ToplistEntry[] = [];

  for (const row of block.querySelectorAll("tr")) {
    const rankNode = row.querySelector("td.pso");
    const anchor = row.querySelector("div.tun a[href]") ?? row.querySelector("td a[href]");
    if (!rankNode && !anchor) {
      continue;
    }

    const href = anchorHref(anchor, url);
    const label =
      cleanText(anchor?.textContent) || cleanText(row.querySelector("td:last-child")?.textContent);
    if (label === "" && href === null) {
      continue;
    }

    const gid = galleryIdentity(href)?.gid ?? null;
    entries.push({
      rank: parseNumber(rankNode?.textContent) ?? entries.length + 1,
      label,
      href,
      gid,
      score: null,
      uploader: null,
      uploaderHref: null,
      posted: "",
      pages: null,
      category: null,
      torrentsHref: null,
    });
  }

  return entries;
}

function parseOverview(doc: Document, url: string): ToplistOverview {
  const sections: ToplistSection[] = [];
  for (const block of doc.querySelectorAll(".tdo")) {
    const title = cleanText(block.querySelector("p a[href]")?.textContent);
    const entries = parseEntries(block, url);
    if (title === "" && entries.length === 0) {
      continue;
    }
    sections.push({ title, entries });
  }

  const sources: TabSource[] = [];
  for (const anchor of doc.querySelectorAll(".tdo p a[href]")) {
    const href = anchorHref(anchor, url);
    const key = toplistKey(href);
    if (href !== null && key !== null) {
      sources.push({ key, href, label: cleanText(anchor.textContent) });
    }
  }

  const tabs = buildTabs(sources, toplistKey(url));
  return { kind: "overview", tabs, sections };
}

function categoryTitle(doc: Document): string {
  const crumb = cleanText(doc.querySelector("h1.ih a[href*='tl=']")?.textContent);
  return crumb !== "" ? crumb : cleanText(doc.querySelector("h1.ih")?.textContent);
}

function parseCategory(doc: Document, url: string): ToplistCategory {
  const tabs = buildTabs(catalogueSources(url), toplistKey(url));
  const entries = galleryEntries(doc, url);

  return {
    kind: "category",
    url,
    tabs,
    title: categoryTitle(doc),
    entries: entries.length > 0 ? entries : userEntries(doc, url),
    pager: parsePager(doc, url),
  };
}

/** Parse either toplist shape: the `/toplist.php` overview or one `?tl=N` category list. */
export function parseToplist(doc: Document, url: string): ToplistPage {
  if (doc.querySelector(".tdo")) {
    return parseOverview(doc, url);
  }
  if (doc.querySelector("table.itg")) {
    return parseCategory(doc, url);
  }
  return { kind: "overview", tabs: [], sections: [] };
}
