/**
 * The site's numeric pager.
 *
 * Listing pages carry one of two pager tables (`table.ptt` or `table.ptb`): the current page sits
 * in a `.ptds` cell, page links are cells whose whole text is a number, and the arrows are anchors
 * labelled `<` and `>`.
 */

import { anchorHref, cleanText, parseNumber } from "./helpers";

/** The pager table on a page, in document order. */
export function pagerTable(doc: Document): Element | null {
  return doc.querySelector("table.ptt, table.ptb");
}

/** Page numbers shown in the pager, in display order. */
export function pagerPages(table: Element | null): number[] {
  if (!table) {
    return [];
  }
  const pages: number[] = [];
  for (const cell of table.querySelectorAll("td")) {
    const text = cleanText(cell.textContent);
    if (/^\d+$/.test(text)) {
      pages.push(Number.parseInt(text, 10));
    }
  }
  return pages;
}

/** The page the pager marks as current, or null when it marks none. */
export function pagerCurrent(table: Element | null): number | null {
  if (!table) {
    return null;
  }
  for (const cell of table.querySelectorAll("td.ptds")) {
    const page = parseNumber(cleanText(cell.textContent));
    if (page !== null) {
      return page;
    }
  }
  return null;
}

/** The previous and next page links, resolved against `base`. */
export function pagerArrows(
  table: Element | null,
  base: string,
): { prevHref: string | null; nextHref: string | null } {
  const arrows = { prevHref: null as string | null, nextHref: null as string | null };
  if (!table) {
    return arrows;
  }
  for (const anchor of table.querySelectorAll("a[href]")) {
    const label = cleanText(anchor.textContent);
    if (label === "<" && arrows.prevHref === null) {
      arrows.prevHref = anchorHref(anchor, base);
    } else if (label === ">" && arrows.nextHref === null) {
      arrows.nextHref = anchorHref(anchor, base);
    }
  }
  return arrows;
}
