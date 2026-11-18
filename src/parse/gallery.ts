import { ParseMismatchError } from "../fetch/errors";
import { isSiteHost } from "../site";
import type {
  FavoriteMark,
  GalleryActions,
  GalleryApiConfig,
  GalleryComment,
  GalleryData,
  GalleryRating,
  GalleryThumb,
  PageRange,
  TagGroup,
  TagRef,
} from "../types";
import { anchorHref, categoryFromNode, cleanText, parseNumber } from "./helpers";
import { parseTitle } from "./title";
import { galleryIdentity, safeUrl } from "./url";

function backgroundUrl(node: Element | null): string | null {
  if (!node || !("style" in node)) {
    return null;
  }
  const match = /url\(["']?(.*?)["']?\)/.exec((node as HTMLElement).style.backgroundImage);
  return match?.[1] ?? null;
}

/** The pixel size an element's inline `width`/`height` pins, as the site writes it on `#gd1`. */
function inlineSize(node: Element | null): { width: number; height: number } | null {
  if (!node || !("style" in node)) {
    return null;
  }
  const { width, height } = (node as HTMLElement).style;
  const parsed = { width: Number.parseFloat(width), height: Number.parseFloat(height) };
  return parsed.width > 0 && parsed.height > 0 ? parsed : null;
}

/** Read a string or numeric literal assigned in an inline script. */
function scriptValue(doc: Document, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|[;\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`,
    "m",
  );
  for (const script of doc.querySelectorAll("script")) {
    if (script.getAttribute("src") !== null) {
      continue;
    }
    const match = pattern.exec(script.textContent);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

/** Inline-script credentials every mutation API expects. */
export interface ApiCredentials {
  apiUrl: string;
  apiUid: string;
  apiKey: string;
}

/**
 * Parse the inline API credentials pages use for ratings, tag votes and user-tag edits.
 *
 * The site writes these into a `var` block; return null when any piece is missing.
 */
export function parseApiCredentials(doc: Document): ApiCredentials | null {
  const apiUrl = scriptValue(doc, "api_url");
  const apiUid = scriptValue(doc, "apiuid");
  const apiKey = scriptValue(doc, "apikey");
  if (!apiUrl || !apiUid || !apiKey) {
    return null;
  }
  return { apiUrl, apiUid, apiKey };
}

/**
 * Parse the gallery API credentials: the shared pieces plus the gid/token every gallery mutation
 * must also carry.
 */
export function parseGalleryApiConfig(doc: Document): GalleryApiConfig | null {
  const credentials = parseApiCredentials(doc);
  const gid = scriptValue(doc, "gid");
  const token = scriptValue(doc, "token");
  if (credentials === null || !gid || !token) {
    return null;
  }
  return { ...credentials, gid, token };
}

function parseTags(doc: Document, url: string): TagGroup[] {
  const groups: TagGroup[] = [];
  for (const row of doc.querySelectorAll("#taglist tr")) {
    const ns = cleanText(row.querySelector("td.tc")?.textContent).replace(/:$/, "");
    const anchors = [...row.querySelectorAll<HTMLAnchorElement>("td a[href*='/tag/']")];
    if (!ns || anchors.length === 0) {
      continue;
    }
    groups.push({
      ns,
      tags: anchors.map((anchor): TagRef => {
        // The site appends an editorial note after a pipe: `japanese | definition revised …`.
        const [name = "", ...note] = cleanText(anchor.textContent).split(" | ");
        const trimmed = note.join(" | ").trim();
        return {
          name: name.trim(),
          href: anchorHref(anchor, url) ?? "",
          note: trimmed === "" ? null : trimmed,
        };
      }),
    });
  }
  return groups;
}

function parseThumbs(doc: Document, url: string): GalleryThumb[] {
  const grid = doc.getElementById("gdt");
  if (!grid) {
    return [];
  }

  const thumbs: GalleryThumb[] = [];
  const spriteCounts = new Map<string, number>();

  [...grid.children].forEach((node, index) => {
    if (node.localName !== "a") {
      return;
    }
    const tile = node.querySelector<HTMLElement>("div[style]");
    if (!tile) {
      return;
    }

    const sprite = backgroundUrl(tile);
    if (!sprite) {
      return;
    }

    const width = Number.parseFloat(tile.style.width) || 100;
    const height = Number.parseFloat(tile.style.height) || 100;
    const x =
      Number.parseFloat(tile.style.backgroundPositionX || tile.style.backgroundPosition) || 0;
    const labelMatch = /Page\s+(\d+)/i.exec(tile.title);
    const label = labelMatch?.[1] ? Number.parseInt(labelMatch[1], 10) : index + 1;

    thumbs.push({
      href: anchorHref(node, url) ?? "",
      label,
      sprite,
      x,
      width,
      height,
      spriteCount: 1,
    });
    spriteCounts.set(sprite, (spriteCounts.get(sprite) ?? 0) + 1);
  });

  for (const thumb of thumbs) {
    thumb.spriteCount = spriteCounts.get(thumb.sprite) ?? 1;
  }

  return thumbs;
}

/** Text with `<br>` preserved as newlines and runs of blank lines collapsed. */
function bodyText(node: Node | null): string {
  if (!node) {
    return "";
  }
  if (node.nodeType === 3) {
    return node.textContent ?? "";
  }
  if (node.nodeName === "BR") {
    return "\n";
  }
  return [...node.childNodes].map((child) => bodyText(child)).join("");
}

function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Signed score such as `+78` or `-4`; `parseNumber` would drop the sign. */
function signedNumber(value: string | null | undefined): number | null {
  const match = /^\s*([+-]?\d[\d,]*)/.exec(value ?? "");
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The site prints Edit only on the signed-in author's comments, so its presence is the flag. */
function commentIsEditable(block: Element, id: number): boolean {
  if (block.querySelector(`#comment_edit_${id}, [data-comment-edit="${id}"]`)) {
    return true;
  }
  for (const control of block.querySelectorAll("a, button")) {
    if (/^edit$/iu.test(cleanText(control.textContent))) {
      return true;
    }
  }
  return false;
}

function parseComments(doc: Document, url: string): GalleryComment[] {
  const comments: GalleryComment[] = [];

  for (const block of doc.querySelectorAll("#cdiv .c1")) {
    const body = block.querySelector<HTMLElement>(".c6[id^='comment_']");
    const idText = body?.id.startsWith("comment_") ? body.id.slice("comment_".length) : "";
    const id = Number.parseInt(idText, 10);
    if (!Number.isFinite(id)) {
      continue;
    }

    const header = block.querySelector(".c3");
    const authorAnchor = header?.querySelector<HTMLAnchorElement>("a[href*='/uploader/']");
    const postedText = cleanText(header?.textContent);
    const posted = /Posted on\s+(.+?)\s+by:/i.exec(postedText)?.[1] ?? postedText;
    const scoreNode = block.querySelector<HTMLElement>("[id^='comment_score_']");
    const voteNode = block.querySelector<HTMLElement>("[id^='cvotes_']");
    const marker = block.querySelector(".c4 a[name='ulcomment']");

    comments.push({
      id,
      author: cleanText(authorAnchor?.textContent),
      authorHref: anchorHref(authorAnchor ?? null, url),
      posted,
      body: normalizeBody(bodyText(body)),
      score: signedNumber(scoreNode?.textContent),
      votes: cleanText(voteNode?.textContent) || null,
      uploader: marker !== null,
      editable: commentIsEditable(block, id),
    });
  }

  return comments;
}

function popupTarget(doc: Document, fragment: string, url: string): string | null {
  const anchor = doc.querySelector(`a[onclick*='${fragment}']`);
  const onclick = anchor?.getAttribute("onclick") ?? "";
  const match = /popUp\(\s*(['"])(.*?)\1/.exec(onclick);
  if (!match?.[2]) {
    return null;
  }
  return safeUrl(match[2].replace(/&amp;/g, "&"), url)?.href ?? null;
}

/**
 * The base the site's popups hang off.
 *
 * `base_url` comes from the page's inline script, so an off-site value would aim the rename window
 * elsewhere; it only counts while it resolves to the site's own domain. Without a usable value the
 * page's origin is the base, not its path: the popups live at the site root.
 */
function popupBase(declared: string | null, pageUrl: string): string {
  const resolved = declared === null ? null : safeUrl(declared, pageUrl);
  if (resolved !== null && resolved.protocol === "https:" && isSiteHost(resolved.hostname)) {
    return resolved.href;
  }
  return new URL("/", pageUrl).href;
}

function parseActions(doc: Document, url: string): GalleryActions {
  const report = doc.querySelector<HTMLAnchorElement>("a[href*='report=select']");
  const expunge = doc.querySelector<HTMLAnchorElement>("a[href*='act=expunge']");
  const rename = doc.getElementById("renamelink");
  const base = popupBase(scriptValue(doc, "base_url"), url);
  const identity = galleryIdentity(url);
  const popup = rename ? safeUrl("gallerypopups.php", base) : null;

  let renameHref: string | null = null;
  if (identity && popup) {
    popup.searchParams.set("gid", identity.gid);
    popup.searchParams.set("t", identity.token);
    popup.searchParams.set("act", "rename");
    renameHref = popup.href;
  }

  return {
    archiverHref: popupTarget(doc, "archiver.php", url),
    torrentsHref: popupTarget(doc, "gallerytorrents.php", url),
    reportHref: anchorHref(report, url),
    expungeHref: anchorHref(expunge, url),
    renameHref,
  };
}

interface PagingInfo {
  prevHref: string | null;
  nextHref: string | null;
  summary: string;
  pageRange: PageRange | null;
}

/**
 * Parse the site's "Showing A - B of C<suffix>" summary once.
 *
 * The gallery and torrent index print the same line, so the range parser lives here and both
 * parsers share it. The suffix is kept verbatim because some layouts add a noun ("images") and
 * others stop at the total.
 */
export function parsePageRange(text: string): PageRange | null {
  const match = /^Showing\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)(.*)$/iu.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    start: parseNumber(match[1]) ?? 0,
    end: parseNumber(match[2]) ?? 0,
    total: parseNumber(match[3]) ?? 0,
    suffix: match[4] ?? "",
  };
}

/** Format a page range the way the site prints it, with thousands separators. */
export function formatPageRange(range: PageRange): string {
  const number = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const total = number(range.total);
  return `Showing ${number(range.start)} - ${number(range.end)} of ${total}${range.suffix}`;
}

function parsePaging(doc: Document, url: string): PagingInfo {
  const summary = cleanText(doc.querySelector(".gpc")?.textContent);
  const pageRange = parsePageRange(summary);
  if (pageRange === null) {
    return { prevHref: null, nextHref: null, summary, pageRange: null };
  }

  const { start, end, total } = pageRange;

  const current = new URL(url);
  const rawPage = current.searchParams.get("p");
  const urlPage = rawPage === null ? 0 : Math.max(0, Number.parseInt(rawPage, 10) || 0);

  // The last page has fewer thumbnails; infer the real page size from `p`.
  const inferredSize = urlPage > 0 ? Math.round((start - 1) / urlPage) : 0;
  const pageSize = Math.max(1, inferredSize || end - start + 1);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = rawPage === null ? Math.max(0, Math.floor((start - 1) / pageSize)) : urlPage;

  const pageUrl = (index: number): string => {
    const next = new URL(current.href);
    if (index === 0) {
      next.searchParams.delete("p");
    } else {
      next.searchParams.set("p", String(index));
    }
    return next.href;
  };

  return {
    prevHref: page > 0 ? pageUrl(page - 1) : null,
    nextHref: page + 1 < pageCount ? pageUrl(page + 1) : null,
    summary,
    pageRange,
  };
}

/**
 * Favorite folder the gallery sits in.
 *
 * Not favorited: `#fav` is empty and `#favoritelink` holds an image plus "Add to Favorites".
 * Favorited: the star gets a sprite offset for the folder and the link's only child is the folder
 * name, which is what the native button shows in place of the add link.
 */
function parseFavorite(doc: Document): FavoriteMark | null {
  const star = doc.querySelector<HTMLElement>("#fav div");
  const text = cleanText(doc.getElementById("favoritelink")?.textContent);
  const folder = text === "" || /^add to favorites$/i.test(text) ? "" : text;
  const offset = /background-position:\s*0(?:px)?\s+-(\d+)px/i.exec(
    star?.getAttribute("style") ?? "",
  )?.[1];
  const index = offset === undefined ? null : Math.floor((Number(offset) - 2) / 19);
  const slot = index !== null && index >= 0 && index < 10 ? index : null;

  if (star === null && folder === "") {
    return null;
  }
  return { folder, slot };
}

export function parseGalleryPage(doc: Document, url: string): GalleryData {
  const identity = galleryIdentity(url);
  if (!identity) {
    throw new Error(`Invalid gallery URL: ${url}`);
  }

  const metadata = new Map<string, HTMLElement>();
  for (const row of doc.querySelectorAll("#gdd tr")) {
    const label = cleanText(row.querySelector(".gdt1")?.textContent).replace(/:$/, "");
    const value = row.querySelector<HTMLElement>(".gdt2");
    if (label && value) {
      metadata.set(label, value);
    }
  }

  const categoryNode = doc.querySelector<HTMLElement>("#gdc .cs");

  const tags = parseTags(doc, url);
  const thumbs = parseThumbs(doc, url);
  const paging = parsePaging(doc, url);

  const heading = cleanText(doc.getElementById("gn")?.textContent);
  // A layout the selectors no longer know leaves neither a title nor a thumbnail row. Rendering
  // that as `Untitled` with no pages would present a dead page as real, so treat it as a layout
  // break and let the app hand the reader the site's own page. A removed gallery still serves a
  // real 404 body, which the app's initial-load check catches before parsing.
  if (heading === "" && thumbs.length === 0) {
    throw new ParseMismatchError("gallery", "the title and page thumbnails are missing");
  }

  const title = heading || "Untitled";
  const alternateTitle = cleanText(doc.getElementById("gj")?.textContent) || null;
  const uploaderNode = doc.querySelector<HTMLAnchorElement>("#gdn a[href*='/uploader/']");
  const parentAnchor = metadata.get("Parent")?.querySelector("a") ?? null;
  const parentHref = parentAnchor ? (anchorHref(parentAnchor, url) ?? "") : null;
  const lengthText = cleanText(metadata.get("Length")?.textContent);
  const ratingText = cleanText(doc.getElementById("rating_label")?.textContent);
  const ratingMatch = /Average:\s*([\d.]+)/i.exec(ratingText);
  const ratingCount =
    parseNumber(doc.getElementById("rating_count")?.textContent) ??
    parseNumber(metadata.get("Rating")?.textContent);
  const apiConfig = parseGalleryApiConfig(doc);
  const displayRating = Number.parseFloat(scriptValue(doc, "display_rating") ?? "");
  // The site colours the star sprite once the viewer has rated (`irr` red, `irg` green,
  // `irb` blue). While it still has the plain `ir` class, `display_rating` is the average.
  const ratingClass = doc.getElementById("rating_image")?.getAttribute("class") ?? "";
  const rated = /\bir[rgb]\b/.test(ratingClass);
  const ratingInfo: GalleryRating = {
    average: ratingMatch?.[1] ? Number.parseFloat(ratingMatch[1]) : null,
    votes: ratingCount,
    user: rated && Number.isFinite(displayRating) ? Math.min(5, Math.max(0, displayRating)) : null,
  };

  const coverNode = doc.querySelector("#gd1 div[style*='background']");

  return {
    url,
    gid: identity.gid,
    token: identity.token,
    title: parseTitle(title),
    alternateTitle,
    category: categoryFromNode(categoryNode),
    uploader: uploaderNode
      ? { name: cleanText(uploaderNode.textContent), href: anchorHref(uploaderNode, url) ?? "" }
      : null,
    posted: cleanText(metadata.get("Posted")?.textContent),
    parentHref,
    size: cleanText(metadata.get("File Size")?.textContent),
    pageCount: parseNumber(lengthText) ?? thumbs.length,
    favCount: parseNumber(doc.getElementById("favcount")?.textContent),
    rating: ratingMatch?.[1] ? Number.parseFloat(ratingMatch[1]) : null,
    ratingCount,
    favorite: parseFavorite(doc),
    tags,
    thumbs,
    coverSrc: backgroundUrl(coverNode),
    coverSize: inlineSize(coverNode),
    pageSummary: paging.summary,
    pageRange: paging.pageRange,
    firstPageHref: thumbs[0]?.href ?? null,
    prevHref: paging.prevHref,
    nextHref: paging.nextHref,
    comments: parseComments(doc, url),
    ratingInfo,
    actions: parseActions(doc, url),
    visible: cleanText(metadata.get("Visible")?.textContent) || null,
    apiConfig,
  };
}
