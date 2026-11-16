import type { ListItem } from "../types";
import { cleanText, parseNumber } from "./helpers";
import { parseListPage } from "./list";
import { safeUrl } from "./url";

/** One numbered favorite folder and how many galleries it holds. */
interface FavoriteFolderTab {
  slot: number;
  name: string;
  count: number;
}

/** Sort orders offered by the favorites page. */
export type FavoriteOrder = "published" | "favorited";

/** Everything the favorites view renders for one page load. */
export interface FavoritesPage {
  /** Address this page was loaded from; the view builds folder and order links from it. */
  url: string;
  folders: readonly FavoriteFolderTab[];
  active: number | "all";
  order: FavoriteOrder;
  items: readonly ListItem[];
  /** Saved note text per gallery id; galleries without a note are absent. */
  notes: ReadonlyMap<string, string>;
  /** Search text applied inside the favorites list, or "" when browsing a folder. */
  search: string;
  nextHref: string | null;
  prevHref: string | null;
  summary: string | null;
}

const FAVCAT = /favcat=(\d+)/;
const NOTE_ID = /^favnote_(.+)$/;
const ORDER_SELECT = 'option[value="f"]';

function urlParam(url: string, key: string): string | null {
  return safeUrl(url)?.searchParams.get(key) ?? null;
}

function orderOf(value: string | null): FavoriteOrder | null {
  if (value === "p" || value === "fs_p") {
    return "published";
  }
  if (value === "f" || value === "fs_f") {
    return "favorited";
  }
  return null;
}

/**
 * Order from the control the page rendered, falling back to the URL and then to the site default.
 *
 * The page carries two selects (order and thumbnail size) whose values overlap on `p`, so the order
 * select is the one with a `f` option. A `<select>` without a `selected` attribute shows its first
 * option, so that option wins over the URL.
 */
function parseOrder(doc: Document, url: string): FavoriteOrder {
  for (const select of doc.querySelectorAll("select")) {
    if (!select.querySelector(ORDER_SELECT)) {
      continue;
    }
    const marked = select.querySelector("option[selected]");
    const first = select.querySelector("option");
    return (
      orderOf(marked?.getAttribute("value") ?? null) ??
      orderOf(urlParam(url, "inline_set")) ??
      orderOf(first?.getAttribute("value") ?? null) ??
      "favorited"
    );
  }
  return orderOf(urlParam(url, "inline_set")) ?? "favorited";
}

function folderName(tab: Element): string {
  const fromIcon = cleanText(tab.querySelector(".i")?.getAttribute("title"));
  if (fromIcon) {
    return fromIcon;
  }
  const labels = tab.querySelectorAll("div");
  return cleanText(labels[labels.length - 1]?.textContent);
}

interface FolderTabs {
  folders: FavoriteFolderTab[];
  active: number | "all" | null;
}

/**
 * Read the `.fp` tab strip. The trailing "Show All Favorites" tab carries no `favcat` but still
 * signals the active view through `.fps`.
 */
function parseFolderTabs(doc: Document): FolderTabs {
  const folders: FavoriteFolderTab[] = [];
  let active: number | "all" | null = null;

  for (const tab of doc.querySelectorAll(".fp")) {
    const slotMatch = FAVCAT.exec(tab.getAttribute("onclick") ?? "");
    const activeTab = tab.classList.contains("fps");

    if (slotMatch?.[1] === undefined) {
      if (activeTab) {
        active = "all";
      }
      continue;
    }

    folders.push({
      slot: Number.parseInt(slotMatch[1], 10),
      name: folderName(tab),
      count: parseNumber(tab.querySelector("div")?.textContent) ?? 0,
    });
    if (activeTab) {
      active = Number.parseInt(slotMatch[1], 10);
    }
  }

  return { folders, active };
}

function parseActive(tabs: FolderTabs, url: string): number | "all" {
  if (tabs.active !== null) {
    return tabs.active;
  }
  const value = urlParam(url, "favcat");
  if (value === null || value === "all") {
    return "all";
  }
  return /^[0-9]$/.test(value) ? Number.parseInt(value, 10) : "all";
}

/** Saved note text from a `#favnote_<gid>` node, which the site renders as a text-bearing node. */
function noteText(node: Element): string {
  // linkedom and the browser expose `value` on form controls only; `in` narrows without a cast.
  const raw: unknown = "value" in node && node.value !== "" ? node.value : node.textContent;
  return typeof raw === "string" ? cleanText(raw) : "";
}

function parseNotes(doc: Document): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const node of doc.querySelectorAll("[id^='favnote_']")) {
    const gid = NOTE_ID.exec(node.id)?.[1];
    if (gid === undefined || notes.has(gid)) {
      continue;
    }
    const text = noteText(node);
    if (text) {
      notes.set(gid, text);
    }
  }
  return notes;
}

/**
 * Parse a favorites page.
 *
 * Cards are the shared `.gl1t` thumbnails, so `parseListPage` supplies items, cursors and the
 * result summary; this module adds the folder strip, the active tab, the order control and the
 * per-gallery notes.
 */
export function parseFavorites(doc: Document, url: string): FavoritesPage {
  const list = parseListPage(doc, url);
  const tabs = parseFolderTabs(doc);
  return {
    url,
    folders: tabs.folders,
    active: parseActive(tabs, url),
    order: parseOrder(doc, url),
    items: list.items,
    notes: parseNotes(doc),
    search: urlParam(url, "f_search")?.trim() ?? "",
    nextHref: list.nextHref,
    prevHref: list.prevHref,
    summary: list.resultText,
  };
}
