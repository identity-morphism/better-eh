/**
 * Active search filters shown below the search field.
 *
 * The text field stays the source of truth, so a chip is only a structured view of one term: click
 * it to drop the term, right-click to change its sign. The host decides whether that submits a
 * search or only updates a draft.
 */

import type { SearchTerm } from "../tags/model";
import {
  parseSearchTerms,
  removeTerm,
  setTermSign,
  SIGN_PRESENTATION,
  TAG_SIGNS,
  termLabel,
} from "../tags/model";
import type { ActionMenuItem } from "./action-menu";
import { bindContextMenu, openActionMenu } from "./action-menu";
import { buttonEl, el } from "./dom";
import { trackScrollEdges } from "./jump-row";

/** What a chip edit did, so the caller can put focus back where it was. */
export type ChipAction =
  { type: "toggle"; index: number } | { type: "remove"; index: number } | { type: "clear" };

type ChipHandler = (text: string, action: ChipAction) => void;

/** Sign choices for one term; the active sign is left out. */
function signItems(
  term: SearchTerm,
  text: string,
  index: number,
  onSearch: ChipHandler,
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  for (const sign of TAG_SIGNS) {
    if (term.sign === sign) {
      continue;
    }
    items.push({
      label: SIGN_PRESENTATION[sign].action,
      run: () => onSearch(setTermSign(text, term, sign), { type: "toggle", index }),
    });
  }
  items.push({
    label: "Remove",
    run: () => onSearch(removeTerm(text, term), { type: "remove", index }),
  });
  return items;
}

function chip(
  term: SearchTerm,
  text: string,
  index: number,
  onSearch: ChipHandler,
  signal?: AbortSignal,
): HTMLElement {
  const node = el("span", {
    class: SIGN_PRESENTATION[term.sign].chipClass,
  });

  const toggle = buttonEl({
    class: "term-toggle",
    "aria-label": `${termLabel(term)}, ${SIGN_PRESENTATION[term.sign].state}. Remove from search. Right-click to include, exclude or make optional.`,
    title: "Click to remove · Right-click to include, exclude or make optional",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  toggle.append(
    el("span", {
      class: "term-sign",
      "aria-hidden": "true",
      text: SIGN_PRESENTATION[term.sign].glyph,
    }),
  );
  if (term.ns) {
    toggle.append(
      el("span", {
        class: `term-ns ns-${term.ns.id}`,
        text: term.ns.label,
      }),
    );
  }
  toggle.append(el("span", { class: "term-value", text: termLabel(term) }));
  toggle.addEventListener("click", () => {
    onSearch(removeTerm(text, term), { type: "remove", index });
  });
  bindContextMenu(
    toggle,
    () =>
      openActionMenu({
        anchor: toggle,
        label: `Actions for ${termLabel(term)}`,
        items: signItems(term, text, index, onSearch),
        signal,
      }),
    signal,
  );
  node.append(toggle);

  return node;
}

/** Render one chip per search term, or `null` when the query is empty. */
export function renderSearchChips(
  text: string,
  onSearch: ChipHandler,
  signal?: AbortSignal,
): HTMLElement | null {
  const terms = parseSearchTerms(text);
  if (terms.length === 0) {
    return null;
  }

  const row = el("div", {
    class: "search-filters",
    role: "group",
    "aria-label": "Active search filters",
  });

  terms.forEach((term, index) => {
    row.append(chip(term, text, index, onSearch, signal));
  });

  const clear = buttonEl({ class: "search-filters-clear", text: "Clear", title: "Clear search" });
  clear.addEventListener("click", () => {
    onSearch("", { type: "clear" });
  });
  row.append(clear);
  trackScrollEdges(row);

  return row;
}
