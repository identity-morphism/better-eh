import { getSettings } from "../settings";
import { el } from "./dom";
import { bindViewScale } from "./view-scale";

const MOBILE_WIDTH = 720;
const MOBILE_CARD_SIZE = 150;

interface CardGrid {
  readonly element: HTMLElement;
  /** Append cards after the ones already shown without moving them. */
  append: (cards: readonly HTMLElement[]) => void;
  /** Number of cards in the grid, including ones appended before its first layout. */
  size: () => number;
  /** Remove cards previously appended, keeping the remaining ones in place. */
  remove: (cards: readonly HTMLElement[]) => void;
  /** Place every recorded card; the single rebuild once the grid is attached and has a width. */
  refresh: () => void;
}

/**
 * A result grid whose columns are real elements.
 *
 * CSS multi-column reflows the whole feed whenever a page is appended: the browser rebalances every
 * column, so already-read cards jump. This grid owns one flex column per track and places each card
 * round-robin, which keeps existing cards exactly where they were when infinite scroll appends.
 * Rows stay top-aligned, so cards keep their own cover aspect instead of stretching to the tallest
 * neighbour.
 *
 * Views build the cards before appending the grid to the document, so `append` only records them
 * until `refresh` measures the attached grid. That way no card is placed into a provisional column
 * and then moved again.
 */
export function createCardGrid(signal: AbortSignal): CardGrid {
  const element = el("div", { class: "card-grid" });
  const cards: HTMLElement[] = [];
  let columns: HTMLElement[] = [];
  let nextColumn = 0;
  /** Whether `refresh` has placed the cards; until then `append` only records them. */
  let placed = false;

  function measureWidth(): number {
    return element.clientWidth || element.getBoundingClientRect().width || 0;
  }

  function columnCount(width: number): number {
    if (width <= 0) {
      return 1;
    }
    const size = window.innerWidth <= MOBILE_WIDTH ? MOBILE_CARD_SIZE : getSettings().listThumbSize;
    const space = getSettings().gap;
    const fitted = Math.floor((width + space) / (size + space));
    return Math.max(1, fitted);
  }

  function rebuild(count: number): void {
    columns = Array.from({ length: count }, () => el("div", { class: "card-column" }));
    const fragment = document.createDocumentFragment();
    fragment.append(...columns);
    element.replaceChildren(fragment);
    cards.forEach((card, index) => {
      columns[index % count]?.append(card);
    });
    nextColumn = cards.length % count;
  }

  function layout(): void {
    // Measure before touching the style: writing a property invalidates the element's box, so a
    // width read afterwards would force a synchronous layout.
    const width = measureWidth();
    element.style.setProperty("--gap", `${getSettings().gap}px`);
    if (!placed) {
      return;
    }
    const count = columnCount(width);
    if (count !== columns.length) {
      rebuild(count);
    }
  }

  bindViewScale({ signal, apply: layout });

  return {
    element,
    append: (incoming) => {
      if (!placed) {
        for (const card of incoming) {
          cards.push(card);
        }
        return;
      }
      for (const card of incoming) {
        cards.push(card);
        columns[nextColumn]?.append(card);
        nextColumn = (nextColumn + 1) % columns.length;
      }
    },
    size: () => cards.length,
    remove: (removing) => {
      const removed = new Set(removing);
      for (const card of removing) {
        card.remove();
      }
      let kept = 0;
      for (const card of cards) {
        if (!removed.has(card)) {
          cards[kept] = card;
          kept += 1;
        }
      }
      cards.length = kept;
      nextColumn = cards.length % Math.max(1, columns.length);
    },
    refresh: () => {
      const width = measureWidth();
      element.style.setProperty("--gap", `${getSettings().gap}px`);
      placed = true;
      rebuild(columnCount(width));
    },
  };
}
