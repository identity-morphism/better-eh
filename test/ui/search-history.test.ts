import { beforeEach, describe, expect, test } from "bun:test";

import { HTMLElement as LinkedomElement } from "linkedom";

import { emptySearchQuery } from "../../src/parse/query";
import { setSearchQuery } from "../../src/search-draft";
import { updateSetting } from "../../src/settings";
import { renderTopbar } from "../../src/ui/topbar";
import { installDom, mountHost } from "./dom";

let host: HTMLElement;
let searched: string[];

function render(): void {
  host.append(
    renderTopbar({
      onSearch: (text) => {
        searched.push(text);
      },
      signal: new AbortController().signal,
    }),
  );
}

function input(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>('input[name="f_search"]');
  if (!found) {
    throw new Error("missing search input");
  }
  return found;
}

function historyPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>(".search-history-panel");
  if (!panel) {
    throw new Error("missing history panel");
  }
  return panel;
}

function openHistory(): HTMLElement {
  host.querySelector<HTMLButtonElement>('[aria-label="Search history"]')?.click();
  return historyPanel();
}

function submitSearch(text: string): void {
  input().value = text;
  host
    .querySelector<HTMLFormElement>(".topbar-search")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** Open the shared editor from the history panel's save button. */
function openEditor(panel: HTMLElement): HTMLElement {
  panel.querySelector<HTMLButtonElement>(".search-history-save-current")?.click();
  const editor = document.querySelector<HTMLElement>(".quick-tag-editor-panel");
  if (!editor) {
    throw new Error("missing quick tag editor");
  }
  return editor;
}

/** Fill the seeded editor row and submit it; the history panel rerenders on save. */
function saveCurrent(panel: HTMLElement, name: string): void {
  const editor = openEditor(panel);
  const nameInput = editor.querySelector<HTMLInputElement>(".quick-tag-name");
  if (!nameInput) {
    throw new Error("missing quick tag name");
  }
  nameInput.value = name;
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  editor
    .querySelector<HTMLFormElement>("form.quick-tag-editor")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  installDom();
  updateSetting("tagSuggestions", false);
  GM_setValue("eh:search-history:v1", []);
  GM_setValue("eh:saved-expressions:v1", []);
  setSearchQuery(emptySearchQuery());
  host = mountHost();
  searched = [];
  render();
});

describe("search history panel", () => {
  test("records a submitted query and re-runs it from the panel", () => {
    submitSearch("big breasts");
    expect(searched).toEqual(["big breasts"]);

    const panel = openHistory();
    const entry = [...panel.querySelectorAll<HTMLButtonElement>(".search-history-query")].find(
      (button) => button.textContent.includes("big breasts"),
    );
    entry?.click();
    expect(searched).toEqual(["big breasts", "big breasts"]);
  });

  test("seeds a focused editor and saves the row without a name", () => {
    input().value = "f:artbook$";
    const panel = openHistory();

    // linkedom has no document.activeElement; record focus calls instead. The seeded query must
    // be focused after the popover's own autofocus, so it is the last target.
    const focused: Element[] = [];
    const proto = LinkedomElement.prototype as unknown as { focus: () => void };
    const originalFocus = proto.focus;
    proto.focus = function focus(this: HTMLElement): void {
      focused.push(this);
    };
    try {
      const editor = openEditor(panel);
      const query = editor.querySelector<HTMLInputElement>(".quick-tag-query");
      if (!query) {
        throw new Error("missing seeded query");
      }
      expect(query.value).toBe("f:artbook$");
      expect(focused.at(-1)).toBe(query);
      editor
        .querySelector<HTMLFormElement>("form.quick-tag-editor")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    } finally {
      proto.focus = originalFocus;
    }

    expect(panel.querySelector(".search-history-quick-tag")?.textContent).toContain("f:artbook$");
  });

  test("clears recent searches and removes quick tags without crossing the two lists", () => {
    submitSearch("english");
    let panel = openHistory();
    saveCurrent(panel, "Language");

    panel.querySelector<HTMLButtonElement>(".search-history-clear")?.click();
    panel = historyPanel();
    expect(panel.textContent).not.toContain("Recent");
    expect(panel.textContent).toContain("Language");

    panel.querySelector<HTMLButtonElement>(".search-history-remove")?.click();
    panel = historyPanel();
    expect(panel.querySelector(".search-history-quick-tag")).toBeNull();
    expect(panel.textContent).toContain("No recent searches or quick tags yet.");
  });

  test("quick tags add and remove their terms without submitting a search", () => {
    input().value = "f:lolicon$";
    input().dispatchEvent(new Event("input", { bubbles: true }));

    let panel = openHistory();
    saveCurrent(panel, "LOLI");

    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    historyPanel()
      .querySelector<HTMLButtonElement>(".search-history-quick-tag .search-history-query")
      ?.click();
    expect(input().value).toBe("cat f:lolicon$");
    expect(searched).toEqual([]);

    panel = openHistory();
    panel
      .querySelector<HTMLButtonElement>(".search-history-quick-tag .search-history-query")
      ?.click();
    expect(input().value).toBe("cat");
    expect(searched).toEqual([]);
  });
});
