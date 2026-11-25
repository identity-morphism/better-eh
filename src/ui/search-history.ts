/** History button and panel for the top search field. */

import { quickTags, removeQuickTag } from "../data/quick-tags";
import { clearRecentQueries, recentQueries } from "../data/search-history";
import { buttonEl, el, icon } from "./dom";
import { bindPopover } from "./popover";
import { openQuickTagEditor } from "./quick-tags-editor";

export interface SearchHistoryOptions {
  /** The current draft in the search field. */
  getQuery: () => string;
  /** Insert and run a query picked from the recent list. */
  onPick: (text: string) => void;
  /** Add or remove a quick tag's terms in the current draft. */
  onToggle: (text: string) => void;
  signal: AbortSignal;
}

function queryButton(text: string, label: string, onPick: () => void): HTMLElement {
  return buttonEl(
    { class: "search-history-query", title: text, onclick: onPick },
    el("span", { class: "search-history-name", text: label }),
    label === text ? null : el("span", { class: "search-history-text", text: text }),
  );
}

/**
 * Button that opens the recent/quick-tag panel.
 *
 * Every open rebuilds the panel from storage, so a query cleared or a tag edited while it is open
 * (or in another tab) is reflected without keeping a second in-memory copy.
 */
export function searchHistoryButton(options: SearchHistoryOptions): HTMLButtonElement {
  const button = buttonEl({
    class: "topbar-history",
    "aria-label": "Search history",
    title: "Recent searches and quick tags",
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
      const clear = buttonEl({ class: "search-history-clear", text: "Clear recent" });
      clear.addEventListener("click", () => {
        clearRecentQueries();
        renderInto(container, close);
      });
      container.append(clear);
    }

    const tags = quickTags();
    if (tags.length > 0) {
      container.append(el("h3", { class: "search-history-heading", text: "Quick tags" }));
      const list = el("div", { class: "search-history-list" });
      for (const entry of tags) {
        const row = el("div", { class: "search-history-quick-tag" });
        row.append(
          queryButton(entry.query, entry.name, () => {
            close();
            options.onToggle(entry.query);
          }),
        );
        const remove = buttonEl({
          class: "search-history-remove",
          text: "×",
          "aria-label": `Remove quick tag ${entry.name}`,
          title: `Remove ${entry.name}`,
        });
        remove.addEventListener("click", () => {
          removeQuickTag(entry.name);
          renderInto(container, close);
        });
        row.append(remove);
        list.append(row);
      }
      container.append(list);
      const edit = buttonEl({
        class: "search-history-edit",
        text: "Edit quick tags",
        title: "Edit quick tags",
      });
      edit.addEventListener("click", () => {
        openQuickTagEditor(edit, options.signal, () => {
          renderInto(container, close);
        });
      });
      container.append(edit);
    }

    if (recent.length === 0 && tags.length === 0) {
      container.append(
        el("p", {
          class: "search-history-empty",
          text: "No recent searches or quick tags yet.",
        }),
      );
    }

    const saveCurrent = buttonEl({
      class: "btn btn-small search-history-save-current",
      text: "Save current as quick tag",
      title: "Save the current search as a quick tag",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    });
    saveCurrent.addEventListener("click", () => {
      openQuickTagEditor(
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
