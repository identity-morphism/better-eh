import { getSettings } from "../settings";
import { el } from "./dom";
import { bindViewScale } from "./view-scale";

const MOBILE_WIDTH = 720;
const MOBILE_CARD_SIZE = 150;

interface CardGrid {
  readonly element: HTMLElement;
  /** Append cards after the ones already shown without moving them. */
  append: (cards: readonly HTMLElement[]) => void;
  /** Remove cards previously appended, keeping the remaining ones in place. */
  remove: (cards: readonly HTMLElement[]) => void;
  /** Recompute the column count once the grid has been attached and has a width. */
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
 */
export function createCardGrid(signal: AbortSignal): CardGrid {
  const element = el("div", { class: "card-grid" });
  const cards: HTMLElement[] = [];
  let columns: HTMLElement[] = [];
  let nextColumn = 0;

  function columnCount(): number {
    const width = element.clientWidth || element.getBoundingClientRect().width || 0;
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
    element.style.setProperty("--gap", `${getSettings().gap}px`);
    const count = columnCount();
    if (count !== columns.length) {
      rebuild(count);
    }
  }

  bindViewScale({ signal, apply: layout });

  return {
    element,
    append: (incoming) => {
      if (columns.length === 0) {
        rebuild(columnCount());
      }
      for (const card of incoming) {
        cards.push(card);
        columns[nextColumn]?.append(card);
        nextColumn = (nextColumn + 1) % columns.length;
      }
    },
    remove: (removing) => {
      const removed = new Set(removing);
      for (const card of removing) {
        card.remove();
      }
      for (let index = cards.length - 1; index >= 0; index--) {
        const card = cards[index];
        if (card !== undefined && removed.has(card)) {
          cards.splice(index, 1);
        }
      }
      nextColumn = cards.length % Math.max(1, columns.length);
    },
    refresh: layout,
  };
}
