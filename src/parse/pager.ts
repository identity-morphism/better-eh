/**
 * The site's numeric pager.
 *
 * Listing pages carry one of two pager tables (`table.ptt` or `table.ptb`): the current page sits
 * in a `.ptds` cell, page links are cells whose whole text is a number, and the arrows are anchors
 * labelled `<` and `>`.
 */

import { anchorHref, cleanText, parseNumber } from "./helpers";

/** Everything one pager table says, read in a single walk over its cells and anchors. */
export interface PagerData {
  /** Page numbers shown, in display order. */
  pages: number[];
  /** The page the pager marks as current, or null when it marks none. */
  current: number | null;
  prevHref: string | null;
  nextHref: string | null;
}

/** The pager table on a page, in document order. */
export function pagerTable(doc: Document): Element | null {
  return doc.querySelector("table.ptt, table.ptb");
}

/** Read page numbers, the current page and both arrows in one pass over the pager table. */
export function pagerData(table: Element | null, base: string): PagerData {
  const data: PagerData = { pages: [], current: null, prevHref: null, nextHref: null };
  if (!table) {
    return data;
  }

  for (const node of table.querySelectorAll("td, a[href]")) {
    if (node.tagName === "TD") {
      const text = cleanText(node.textContent);
      if (/^\d+$/.test(text)) {
        data.pages.push(Number.parseInt(text, 10));
      }
      if (data.current === null && node.classList.contains("ptds")) {
        data.current = parseNumber(text);
      }
      continue;
    }

    const label = cleanText(node.textContent);
    if (label === "<" && data.prevHref === null) {
      data.prevHref = anchorHref(node, base);
    } else if (label === ">" && data.nextHref === null) {
      data.nextHref = anchorHref(node, base);
    }
  }

  return data;
}
