/**
 * Active search filters shown below the search field.
 *
 * The text field stays the source of truth, so a chip is only a structured view of one term: click
 * it to drop the term, right-click to change its sign. The host decides whether that submits a
 * search or only updates a draft. A row is reconciled in place: changing one term rebuilds only
 * that chip, and an edit that leaves every term on screen (a trailing space, a caret move) touches
 * no DOM at all.
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

/** One rendered term. `term` is refreshed on every update so a click removes the live span. */
interface ChipEntry {
  /** Everything that determines the chip's rendered content and state. */
  readonly key: string;
  term: SearchTerm;
  readonly node: HTMLElement;
  readonly toggle: HTMLButtonElement;
}

/** A live chip row: one element kept in place while the draft changes. */
export interface SearchChipsHandle {
  readonly element: HTMLElement;
  /** Reconcile against `text`. Returns false when the text has no terms and the row is empty. */
  update(text: string): boolean;
  destroy(): void;
}

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

function createChipNode(term: SearchTerm): { node: HTMLElement; toggle: HTMLButtonElement } {
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
  node.append(toggle);

  return { node, toggle };
}

/** Forward aborts from the view signal to a row-owned controller, removing the forwarding hook. */
function linkAbort(controller: AbortController, signal: AbortSignal | undefined): void {
  if (signal === undefined) {
    return;
  }
  if (signal.aborted) {
    controller.abort();
    return;
  }
  const forward = (): void => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  controller.signal.addEventListener("abort", () => signal.removeEventListener("abort", forward), {
    once: true,
  });
}

/**
 * Build a row that lives as long as the search header and reconciles itself against the draft.
 *
 * Chip listeners live on a per-render controller, which is aborted before a rebuild, so chips that
 * leave the DOM never accumulate records on the long-lived view signal.
 */
export function createSearchChips(onSearch: ChipHandler, signal?: AbortSignal): SearchChipsHandle {
  const row = el("div", {
    class: "search-filters",
    role: "group",
    "aria-label": "Active search filters",
  });
  const clear = buttonEl({ class: "search-filters-clear", text: "Clear", title: "Clear search" });
  row.append(clear);

  const lifecycle = new AbortController();
  linkAbort(lifecycle, signal);
  clear.addEventListener("click", () => onSearch("", { type: "clear" }), {
    signal: lifecycle.signal,
  });
  trackScrollEdges(row, lifecycle.signal);

  let entries: ChipEntry[] = [];
  let text = "";
  let renderController: AbortController | null = null;
  let destroyed = false;

  function bind(entry: ChipEntry, controller: AbortController): void {
    const { toggle } = entry;
    toggle.addEventListener(
      "click",
      () => {
        const index = entries.indexOf(entry);
        if (index < 0) {
          return;
        }
        onSearch(removeTerm(text, entry.term), { type: "remove", index });
      },
      { signal: controller.signal },
    );
    bindContextMenu(
      toggle,
      () =>
        openActionMenu({
          anchor: toggle,
          label: `Actions for ${termLabel(entry.term)}`,
          items: signItems(entry.term, text, entries.indexOf(entry), onSearch),
          signal: controller.signal,
        }),
      controller.signal,
    );
  }

  /** Replace only the chips between the shared prefix and suffix, preserving the rest. */
  function reconcile(next: readonly ChipEntry[], oldNodes: readonly HTMLElement[]): void {
    const nextNodes = next.map((entry) => entry.node);
    let prefix = 0;
    const limit = Math.min(oldNodes.length, nextNodes.length);
    while (prefix < limit && oldNodes[prefix] === nextNodes[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      oldNodes[oldNodes.length - 1 - suffix] === nextNodes[nextNodes.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const tail = suffix > 0 ? oldNodes[oldNodes.length - suffix] : undefined;
    const reference: Node = tail ?? clear;
    for (let index = prefix; index < oldNodes.length - suffix; index += 1) {
      oldNodes[index]?.remove();
    }
    for (let index = prefix; index < nextNodes.length - suffix; index += 1) {
      const node = nextNodes[index];
      if (node !== undefined) {
        row.insertBefore(node, reference);
      }
    }
  }

  function update(nextText: string): boolean {
    if (destroyed) {
      return false;
    }
    text = nextText;
    const terms = parseSearchTerms(nextText);
    if (terms.length === 0) {
      renderController?.abort();
      renderController = null;
      for (const entry of entries) {
        entry.node.remove();
      }
      entries = [];
      return false;
    }

    // Rendered identity: two terms with the same key look and read the same.
    const wanted = terms.map((term) => ({
      term,
      key: [term.sign, term.ns?.id ?? "", term.ns?.label ?? "", termLabel(term)].join("\u0000"),
    }));
    if (
      entries.length === wanted.length &&
      entries.every((entry, index) => entry.key === wanted[index]?.key)
    ) {
      // The same chips, possibly at new offsets in an edited query: keep both in step.
      for (const [index, entry] of entries.entries()) {
        const nextTerm = wanted[index]?.term;
        if (nextTerm !== undefined) {
          entry.term = nextTerm;
        }
      }
      return true;
    }

    const previous = entries;
    const obsolete = renderController;
    obsolete?.abort();
    const controller = new AbortController();
    linkAbort(controller, signal);
    renderController = controller;

    const pool = new Map<string, ChipEntry[]>();
    for (const entry of previous) {
      const bucket = pool.get(entry.key);
      if (bucket === undefined) {
        pool.set(entry.key, [entry]);
      } else {
        bucket.push(entry);
      }
    }

    const next = wanted.map(({ term, key }): ChipEntry => {
      const reused = pool.get(key)?.shift();
      if (reused !== undefined) {
        reused.term = term;
        bind(reused, controller);
        return reused;
      }
      const { node, toggle } = createChipNode(term);
      const entry: ChipEntry = { key, term, node, toggle };
      bind(entry, controller);
      return entry;
    });

    reconcile(
      next,
      previous.map((entry) => entry.node),
    );
    entries = next;
    return true;
  }

  return {
    element: row,
    update,
    destroy(): void {
      destroyed = true;
      renderController?.abort();
      renderController = null;
      lifecycle.abort();
      entries = [];
      row.remove();
    },
  };
}

/** Render one chip row for a one-shot caller, or `null` when the query is empty. */
export function renderSearchChips(
  text: string,
  onSearch: ChipHandler,
  signal?: AbortSignal,
): HTMLElement | null {
  const chips = createSearchChips(onSearch, signal);
  if (chips.update(text)) {
    return chips.element;
  }
  chips.destroy();
  return null;
}
