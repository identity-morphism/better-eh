/**
 * Active search filters shown below the search field.
 *
 * The text field stays the source of truth, so a chip is only a structured view of one term: click
 * it to drop the term, right-click to change its sign. The host decides whether that submits a
 * search or only updates a draft.
 */

import type { SearchTerm, TagSign } from "../tags/model";
import { parseSearchTerms, removeTerm, setTermSign, termLabel } from "../tags/model";
import type { ActionMenuItem } from "./action-menu";
import { bindContextMenu, openActionMenu } from "./action-menu";
import { el } from "./dom";
import { trackScrollEdges } from "./jump-row";

function signGlyph(term: SearchTerm): string {
  if (term.sign === "-") {
    return "−";
  }
  if (term.sign === "~") {
    return "~";
  }
  return "+";
}

function chipClass(term: SearchTerm): string {
  if (term.sign === "-") {
    return "term-chip is-excluded";
  }
  if (term.sign === "~") {
    return "term-chip is-or";
  }
  return "term-chip";
}

/** What a chip edit did, so the caller can put focus back where it was. */
export type ChipAction =
  { type: "toggle"; index: number } | { type: "remove"; index: number } | { type: "clear" };

type ChipHandler = (text: string, action: ChipAction) => void;

function stateLabel(term: SearchTerm): string {
  if (term.sign === "-") {
    return "excluded";
  }
  if (term.sign === "~") {
    return "optional";
  }
  return "included";
}

/** Sign choices for one term; the active sign is left out. */
function signItems(
  term: SearchTerm,
  text: string,
  index: number,
  onSearch: ChipHandler,
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  const set = (sign: TagSign, label: string): void => {
    if (term.sign !== sign) {
      items.push({
        label,
        run: () => onSearch(setTermSign(text, term, sign), { type: "toggle", index }),
      });
    }
  };
  set("", "Include in search");
  set("-", "Exclude from search");
  set("~", "Make optional (OR)");
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
    class: chipClass(term),
  });

  const toggle = el("button", {
    class: "term-toggle",
    type: "button",
    "aria-label": `${termLabel(term)}, ${stateLabel(term)}. Remove from search. Right-click to include, exclude or make optional.`,
    title: "Click to remove · Right-click to include, exclude or make optional",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  toggle.append(el("span", { class: "term-sign", "aria-hidden": "true", text: signGlyph(term) }));
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

  const clear = el("button", {
    class: "search-filters-clear",
    type: "button",
    text: "Clear",
    title: "Clear search",
  });
  clear.addEventListener("click", () => {
    onSearch("", { type: "clear" });
  });
  row.append(clear);
  trackScrollEdges(row);

  return row;
}
