/** History button and panel for the top search field. */

import { removeExpression, savedExpressions } from "../data/saved-expressions";
import { clearRecentQueries, recentQueries } from "../data/search-history";
import { el, icon } from "./dom";
import { bindPopover } from "./popover";
import { openExpressionEditor } from "./saved-expressions";

export interface SearchHistoryOptions {
  /** The current draft in the search field. */
  getQuery: () => string;
  /** Insert and run a query picked from either list. */
  onPick: (text: string) => void;
  /** Add or remove a saved expression's terms in the current draft. */
  onToggle: (text: string) => void;
  signal: AbortSignal;
}

function queryButton(text: string, label: string, onPick: () => void): HTMLElement {
  return el(
    "button",
    { class: "search-history-query", type: "button", title: text, onclick: onPick },
    el("span", { class: "search-history-name", text: label }),
    label === text ? null : el("span", { class: "search-history-text", text: text }),
  );
}

/**
 * Button that opens the recent/saved search panel.
 *
 * Every open rebuilds the panel from storage, so a query saved or cleared while it is open (or in
 * another tab) is reflected without keeping a second in-memory copy.
 */
export function searchHistoryButton(options: SearchHistoryOptions): HTMLButtonElement {
  const button = el("button", {
    class: "topbar-history",
    type: "button",
    "aria-label": "Search history",
    title: "Recent and saved searches",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
  });
  button.append(icon("history"));

  function renderInto(container: HTMLElement, close: () => void): void {
    container.replaceChildren();
    const heading = el("h2", { class: "search-history-title", text: "Search history" });
    container.append(heading);

    const recent = recentQueries();
    if (recent.length > 0) {
      container.append(el("h3", { class: "search-history-heading", text: "Recent" }));
      const list = el("div", { class: "search-history-list" });
      for (const entry of recent) {
        list.append(
          queryButton(entry.text, entry.text, () => {
            close();
            options.onPick(entry.text);
          }),
        );
      }
      container.append(list);
      const clear = el("button", {
        class: "search-history-clear",
        type: "button",
        text: "Clear recent",
      });
      clear.addEventListener("click", () => {
        clearRecentQueries();
        renderInto(container, close);
      });
      container.append(clear);
    }

    const saved = savedExpressions();
    if (saved.length > 0) {
      container.append(el("h3", { class: "search-history-heading", text: "Saved" }));
      const list = el("div", { class: "search-history-list" });
      for (const entry of saved) {
        const row = el("div", { class: "search-history-saved" });
        row.append(
          queryButton(entry.query, entry.name, () => {
            close();
            if (entry.mode === "toggle") {
              options.onToggle(entry.query);
            } else {
              options.onPick(entry.query);
            }
          }),
        );
        // The row does what the expression says; this button offers the other verb.
        const keepsTerms = entry.mode === "toggle";
        const toggle = el("button", {
          class: "search-history-toggle",
          type: "button",
          text: keepsTerms ? "▶" : "±",
          "aria-label": `${keepsTerms ? "Run" : "Toggle terms of"} ${entry.name}`,
          title: keepsTerms ? "Replace the search with these terms" : "Add or remove these terms",
        });
        toggle.addEventListener("click", () => {
          close();
          if (keepsTerms) {
            options.onPick(entry.query);
          } else {
            options.onToggle(entry.query);
          }
        });
        const remove = el("button", {
          class: "search-history-remove",
          type: "button",
          text: "×",
          "aria-label": `Remove saved search ${entry.name}`,
          title: `Remove ${entry.name}`,
        });
        remove.addEventListener("click", () => {
          removeExpression(entry.name);
          renderInto(container, close);
        });
        row.append(toggle, remove);
        list.append(row);
      }
      container.append(list);
      const edit = el("button", {
        class: "search-history-edit",
        type: "button",
        text: "Edit saved",
        title: "Edit saved searches and quick tags",
      });
      edit.addEventListener("click", () => {
        openExpressionEditor(edit, options.signal, () => {
          renderInto(container, close);
        });
      });
      container.append(edit);
    }

    if (recent.length === 0 && saved.length === 0) {
      container.append(
        el("p", {
          class: "search-history-empty",
          text: "No recent searches yet. Queries you submit appear here.",
        }),
      );
    }

    const saveCurrent = el("button", {
      class: "btn btn-small search-history-save-current",
      type: "button",
      text: "Save current search",
      title: "Save the current search",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    });
    saveCurrent.addEventListener("click", () => {
      openExpressionEditor(
        saveCurrent,
        options.signal,
        () => {
          renderInto(container, close);
        },
        { seed: options.getQuery() },
      );
    });
    container.append(saveCurrent);
  }

  const popover = bindPopover(
    button,
    (close) => {
      const content = el("div", { class: "search-history" });
      renderInto(content, close);
      return { content };
    },
    {
      role: "dialog",
      label: "Search history",
      className: "search-history-panel",
      autoFocus: true,
    },
    options.signal,
  );

  button.addEventListener("click", () => popover.toggle(), { signal: options.signal });

  return button;
}
