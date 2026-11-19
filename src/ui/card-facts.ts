/**
 * The fact rows every result surface shares.
 *
 * The card's meta row starts with the category, rating, posted time and page count, in the order
 * the site's own cards use. `posted` builds the time row so the caller can attach its favorite
 * mark.
 */

import type { ListItem } from "../types";
import { el } from "./dom";
import { starRow } from "./stars";
import { countText } from "./text";

/** Category, rating, posted time and page count, in the order the site's own cards use. */
export function cardFactRows(item: ListItem, posted: (text: string) => HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  if (item.category) {
    rows.push(el("span", { class: `cat-badge ${item.category.cls}`, text: item.category.name }));
  }
  const stars = starRow(item.rating);
  if (stars) {
    rows.push(stars);
  }
  if (item.posted) {
    rows.push(posted(item.posted));
  }
  if (item.pages) {
    rows.push(el("span", { text: countText(item.pages, "page") }));
  }
  return rows;
}
