import type { FavoriteMark, ListItem, ListPageData } from "../types";
import { anchorHref, categoryFromNode, cleanText } from "./helpers";
import { parseTitle } from "./title";
import { galleryIdentity } from "./url";

/** `N pages` as an element's whole text, tolerating the whitespace around it without collapsing it. */
const PAGES_TEXT = /^\s*([\d,]+)\s+pages?\s*$/i;

/**
 * The ten favorite folders' native mark colours, in slot order. The site paints a favorited row's
 * posted date with the slot's `border-color`/`background-color`, so the colour is the only slot
 * identifier in the listing markup.
 */
const FAVORITE_SLOT_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [240, 0, 0],
  [240, 160, 0],
  [208, 208, 0],
  [0, 128, 0],
  [144, 240, 64],
  [64, 176, 240],
  [0, 0, 240],
  [80, 0, 128],
  [224, 128, 224],
];

const FAVORITE_COLOR = /(?:border|background)-color\s*:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

function favoriteSlot(style: string | null): number | null {
  const match = FAVORITE_COLOR.exec(style ?? "");
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  const slot = FAVORITE_SLOT_RGB.findIndex(
    ([red, green, blue]) => red === rgb[0] && green === rgb[1] && blue === rgb[2],
  );
  return slot === -1 ? null : slot;
}

/**
 * Favorite mark on a row's posted date.
 *
 * Unfavorited rows carry a `posted_<gid>` node too, but the site only gives it a folder `title` and
 * the inline folder colour when the gallery sits in a favorite folder. `nodes` are the row's
 * posted-date nodes, already queried by the caller.
 */
function parseFavorite(nodes: Iterable<HTMLElement>): FavoriteMark | null {
  for (const node of nodes) {
    // `postedpop_` is the hover popup; it never carries the folder treatment.
    if (!node.id.startsWith("posted_")) {
      continue;
    }
    const folder = node.getAttribute("title");
    const slot = favoriteSlot(node.getAttribute("style"));
    if (folder === null && slot === null) {
      continue;
    }
    return { folder: cleanText(folder), slot };
  }
  return null;
}

/**
 * Page count from the element whose whole text is `N pages`.
 *
 * The count never stands alone in the source text: it follows the posted time and, in table rows,
 * the uploader name inside the same cell, so `textContent` glues digits onto it (`10:51163 pages`,
 * `alice7410 pages`). Reading one element at a time rejects those merges.
 */
function parsePages(root: Element): number | null {
  // The count is normally a leaf's whole text (`<div>10 pages</div>`, `<span>3 pages</span>`).
  // Reading only leaves skips the glued ancestor text and touches every text node once.
  const nodes = root.querySelectorAll("*");
  for (const node of nodes) {
    if (node.childElementCount !== 0) {
      continue;
    }
    const pages = wholePages(node.textContent);
    if (pages !== null) {
      return pages;
    }
  }
  // Slow path: the number and the noun can sit in different nodes (`<div>3<span> pages</span></div>`),
  // which only the ancestor's whole text reads as `3 pages`.
  for (const node of nodes) {
    if (node.childElementCount === 0) {
      continue;
    }
    const pages = wholePages(node.textContent);
    if (pages !== null) {
      return pages;
    }
  }
  return null;
}

/** Parse an element's whole text as `N pages`; null unless the entire text is the count. */
function wholePages(text: string | null): number | null {
  const digits = PAGES_TEXT.exec(text ?? "")?.[1];
  if (digits === undefined) {
    return null;
  }
  return Number.parseInt(digits.replace(/,/g, ""), 10);
}

function coverSrc(image: HTMLImageElement | null): string | null {
  if (!image) {
    return null;
  }
  const src = image.getAttribute("data-src") ?? image.getAttribute("src") ?? "";
  return src.startsWith("data:") ? null : src;
}

/** The pixel size the site pins on the thumbnail (`style="width:250px;height:353px"`). */
function coverSize(image: HTMLImageElement | null): { width: number; height: number } | null {
  if (!image) {
    return null;
  }
  const width = Number.parseFloat(image.style.width);
  const height = Number.parseFloat(image.style.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The `x y` offset pair the site pins on the rating sprite. */
const RATING_POSITION = /(-?[\d.]+)px\s+(-?[\d.]+)px/;

/**
 * Average rating from the `.ir` star sprite offset.
 *
 * `rt.png` is an 80px window over ten 16px stars: five gold, then five empty. The half-star row's
 * gold run ends 8px earlier, so a row at `y≈-21` encodes halves that the integer row cannot.
 */
function parseRating(root: Element): number | null {
  const position = root.querySelector<HTMLElement>(".ir")?.style.backgroundPosition;
  if (!position) {
    return null;
  }
  const match = RATING_POSITION.exec(position);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const goldRun = Number.parseFloat(match[2]) <= -10 ? 72 : 80;
  const stars = (goldRun + Number.parseFloat(match[1])) / 16;
  return stars >= 0 && stars <= 5 ? Math.round(stars * 2) / 2 : null;
}

/** Torrent popup link; the site renders a grey icon instead of a link on rows without torrents. */
function parseTorrents(root: Element, base: string): string | null {
  const anchor = root.querySelector<HTMLAnchorElement>(".gldown a[href*='gallerytorrents']");
  return anchor ? (anchorHref(anchor, base) ?? null) : null;
}

/** Category cell: compact rows use `.cn`, the minimal and thumbnail layouts `.cs`. */
const CATEGORY_SELECTOR = ".glcat .cn, .glcat .cs, .cn, .cs";
const POSTED_SELECTOR = "div[id^='postedpop_'], div[id^='posted_']";

function parseAnchorLink(
  anchor: HTMLAnchorElement | null,
  base: string,
): { href: string; gid: string; token: string } | null {
  if (!anchor) {
    return null;
  }
  const href = anchorHref(anchor, base);
  if (!href) {
    return null;
  }
  const identity = galleryIdentity(href);
  if (!identity) {
    return null;
  }
  return { href, gid: identity.gid, token: identity.token };
}

/** Per-layout selectors: the same item, marked up differently by the table and thumbnail grids. */
interface ItemSelectors {
  link: string;
  image: string;
  title: string;
  category: string;
}

const TABLE_ROW: ItemSelectors = {
  link: ".gl3c a[href*='/g/'], a[href*='/g/']",
  image: ".glthumb img, img",
  title: ".glink",
  category: CATEGORY_SELECTOR,
};

const THUMB_ITEM: ItemSelectors = {
  link: "a[href*='/g/']",
  image: ".gl3t img, img",
  title: ".glink, .gl4t",
  category: ".cn, .cs",
};

/** One listing item, whether it arrived as a table row or a thumbnail tile. */
function parseItem(root: Element, base: string, selectors: ItemSelectors): ListItem | null {
  const link = root.querySelector<HTMLAnchorElement>(selectors.link);
  const parsedLink = parseAnchorLink(link, base);
  if (!parsedLink) {
    return null;
  }

  const image = root.querySelector<HTMLImageElement>(selectors.image);
  const uploader = root.querySelector<HTMLAnchorElement>("a[href*='/uploader/']");
  const postedNodes = root.querySelectorAll<HTMLElement>(POSTED_SELECTOR);
  const titleText =
    cleanText(root.querySelector(selectors.title)?.textContent) ||
    cleanText(link?.textContent) ||
    "Untitled";

  return {
    href: parsedLink.href,
    gid: parsedLink.gid,
    token: parsedLink.token,
    title: parseTitle(titleText),
    coverSrc: coverSrc(image),
    coverSize: coverSize(image),
    rating: parseRating(root),
    category: categoryFromNode(root.querySelector<HTMLElement>(selectors.category)),
    uploader: cleanText(uploader?.textContent) || null,
    uploaderHref: anchorHref(uploader, base),
    posted: cleanText(postedNodes[0]?.textContent),
    pages: parsePages(root),
    torrentsHref: parseTorrents(root, base),
    favorite: parseFavorite(postedNodes),
  };
}

function nextLink(doc: Document, id: string, base: string): string | null {
  const node = doc.getElementById(id);
  if (!node?.getAttribute("href")) {
    return null;
  }
  return anchorHref(node, base);
}

/**
 * Result count line.
 *
 * Watched pages put their own notice in `.searchtext` ("Filtered N galleries…") and the result line
 * in `p.ip strong` instead, so the count is read first and the notice only as a fallback.
 */
function resultSummary(doc: Document): string | null {
  const raw = cleanText(doc.querySelector(".searchtext p")?.textContent);
  const match = /^(?:Found|Showing)\b[^.]*\./i.exec(raw);
  if (match?.[0]) {
    return match[0];
  }
  const notice = cleanText(doc.querySelector("p.ip strong")?.textContent);
  return notice || raw || null;
}

export function parseListPage(doc: Document, url: string): ListPageData {
  const items: ListItem[] = [];
  const seen = new Set<string>();

  for (const row of doc.querySelectorAll<HTMLTableRowElement>("table.itg > tbody > tr")) {
    const item = parseItem(row, url, TABLE_ROW);
    if (item && !seen.has(item.gid)) {
      seen.add(item.gid);
      items.push(item);
    }
  }

  if (items.length === 0) {
    for (const itemNode of doc.querySelectorAll(".gl1t")) {
      const item = parseItem(itemNode, url, THUMB_ITEM);
      if (item && !seen.has(item.gid)) {
        seen.add(item.gid);
        items.push(item);
      }
    }
  }

  return {
    url,
    items,
    nextHref: nextLink(doc, "dnext", url),
    prevHref: nextLink(doc, "dprev", url),
    resultText: resultSummary(doc),
  };
}
