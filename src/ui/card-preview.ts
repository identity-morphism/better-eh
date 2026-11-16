/**
 * Quick-action preview for result cards.
 *
 * The preview reuses the fields the card already parsed, so opening it costs no request. It opens
 * only from the card's explicit Preview button, so the panel never appears under a pointer that
 * merely crosses the grid; the button keeps every action reachable without changing the card's grid
 * geometry.
 */

import type { ListItem } from "../types";
import { cardFactRows } from "./card-facts";
import { el, icon } from "./dom";
import { favoriteButton } from "./favmenu";
import type { FavoriteSnapshot, FavoriteState } from "./favorite-state";
import { bindPopover } from "./popover";

/** The preview's favorite line for the current state, or null when the gallery is not favorited. */
function favoriteFact(snapshot: FavoriteSnapshot): HTMLElement | null {
  if (snapshot.favorited !== true) {
    return null;
  }
  return el("span", {
    class: "card-preview-favorite",
    text:
      snapshot.folder === null || snapshot.folder === ""
        ? "In favorites"
        : `In: ${snapshot.folder}`,
  });
}

/**
 * Category, rating, posted time, pages, uploader and favorite folder, as the preview lists them.
 *
 * The first four rows come from the card's shared fact builder; the uploader and favorite folder
 * are preview-only. The favorite line reads the card's state, never the stale parsed mark.
 */
function resultFacts(item: ListItem, favorite: FavoriteState): HTMLElement {
  const facts = el(
    "div",
    { class: "card-preview-facts" },
    ...cardFactRows(item, (text) => el("span", { text })),
  );
  if (item.uploader) {
    facts.append(el("span", { text: item.uploader }));
  }
  const mark = favoriteFact(favorite.get());
  if (mark !== null) {
    facts.append(mark);
  }
  return facts;
}

function previewContent(
  item: ListItem,
  favorite: FavoriteState,
): { element: HTMLElement; dispose: () => void } {
  const content = el("div", { class: "card-preview-body" });
  const controller = new AbortController();

  const heading = el(
    "div",
    {},
    el("p", { class: "card-preview-title", text: item.title.primary }),
    item.title.secondary
      ? el("p", { class: "card-preview-secondary", text: item.title.secondary })
      : null,
  );
  content.append(heading);

  const facts = resultFacts(item, favorite);
  content.append(facts);
  const unsubscribe = favorite.subscribe((snapshot) => {
    const current = facts.querySelector<HTMLElement>(".card-preview-favorite");
    const next = favoriteFact(snapshot);
    if (next === null) {
      current?.remove();
    } else if (current === null) {
      facts.append(next);
    } else {
      current.replaceWith(next);
    }
  });

  const actions = el(
    "div",
    { class: "card-preview-actions" },
    el(
      "a",
      { class: "btn btn-primary", href: item.href },
      el("span", { text: "Open gallery" }),
      icon("arrowRight"),
    ),
    item.torrentsHref
      ? el(
          "a",
          {
            class: "btn btn-ghost",
            href: item.torrentsHref,
            "data-native": "",
            target: "_blank",
            rel: "nofollow noopener",
          },
          el("span", { text: "Torrents" }),
        )
      : null,
    favoriteButton(favorite, controller.signal),
  );
  content.append(actions);
  return {
    element: content,
    dispose: () => {
      controller.abort();
      unsubscribe();
    },
  };
}

/**
 * Wire the preview panel to one card's trigger.
 *
 * Returns the trigger to append inside the card body. The panel only exists while open, so a long
 * feed keeps no extra DOM per card; its favorite subscription ends when the panel closes.
 */
export function cardPreview(
  card: HTMLElement,
  item: ListItem,
  signal: AbortSignal,
  favorite: FavoriteState,
): HTMLButtonElement {
  const trigger = el("button", {
    class: "card-preview-trigger",
    type: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    "aria-label": `Preview ${item.title.primary}`,
    title: "Preview",
  });
  // A magnifier means "search" in the topbar; the preview is a look, not a query.
  trigger.append(icon("eye"));

  const popover = bindPopover(
    card,
    (close) => {
      const content = previewContent(item, favorite);
      content.element.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          close();
        }
      });
      return { content: content.element, dispose: content.dispose };
    },
    {
      role: "dialog",
      label: `Preview: ${item.title.primary}`,
      className: "card-preview",
      autoFocus: true,
      expanded: trigger,
    },
    signal,
  );

  trigger.addEventListener("click", () => popover.toggle(), { signal });

  return trigger;
}
