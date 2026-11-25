import { beforeEach, describe, expect, test } from "bun:test";

import { HTMLElement as LinkedomElement } from "linkedom";

import { emptySearchQuery } from "../../src/parse/query";
import { setSearchQuery } from "../../src/search-draft";
import { updateSetting } from "../../src/settings";
import { renderTopbar } from "../../src/ui/topbar";
import { installDom, mountHost } from "./dom";

let host: HTMLElement;
let searched: string[];
let signal: AbortSignal;

function render(): void {
  const controller = new AbortController();
  signal = controller.signal;
  host.append(
    renderTopbar({
      onSearch: (text) => {
        searched.push(text);
      },
      signal,
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
  host.querySelector<HTMLButtonElement>(".topbar-history")?.click();
  return historyPanel();
}

/** Open the shared expression editor from the history panel's save button. */
function openEditor(panel: HTMLElement): HTMLElement {
  panel.querySelector<HTMLButtonElement>(".search-history-save-current")?.click();
  const editor = document.querySelector<HTMLElement>(".expression-editor-panel");
  if (!editor) {
    throw new Error("missing expression editor");
  }
  return editor;
}

/** Fill the seeded editor row and submit it; the history panel rerenders on save. */
function saveCurrent(
  panel: HTMLElement,
  name: string,
  options: { mode?: number; pin?: boolean } = {},
): void {
  const editor = openEditor(panel);
  const nameInput = editor.querySelector<HTMLInputElement>(".expression-name");
  if (!nameInput) {
    throw new Error("missing expression name");
  }
  nameInput.value = name;
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));

  if (options.mode !== undefined) {
    const mode = editor.querySelector<HTMLSelectElement>(".expression-mode");
    if (!mode) {
      throw new Error("missing expression mode");
    }
    mode.selectedIndex = options.mode;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (options.pin === true) {
    const pin = editor.querySelector<HTMLInputElement>(".expression-pin input[type='checkbox']");
    if (!pin) {
      throw new Error("missing expression pin");
    }
    pin.checked = true;
    pin.dispatchEvent(new Event("change", { bubbles: true }));
  }

  editor
    .querySelector<HTMLFormElement>("form.expression-editor")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  installDom();
  updateSetting("tagSuggestions", false);
  GM_setValue("eh:search-history:v1", []);
  GM_setValue("eh:saved-expressions:v1", []);
  GM_setValue("eh:quick-tags:v1", null);
  GM_setValue("eh:saved-searches:v1", null);
  setSearchQuery(emptySearchQuery());
  host = mountHost();
  searched = [];
  render();
});

describe("search history panel", () => {
  test("records a submitted query and re-runs it from the panel", () => {
    input().value = "big brevity";
    host
      .querySelector<HTMLFormElement>(".topbar-search")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(searched).toEqual(["big brevity"]);

    const panel = openHistory();
    expect(panel.textContent).toContain("big brevity");

    const entry = [...panel.querySelectorAll<HTMLButtonElement>(".search-history-query")].find(
      (button) => button.textContent.includes("big brevity"),
    );
    entry?.click();
    expect(searched).toEqual(["big brevity", "big brevity"]);
  });

  test("seeds the shared editor with the current query and saves it under a name", () => {
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
      const query = editor.querySelector<HTMLInputElement>(".expression-query");
      if (!query) {
        throw new Error("missing seeded query");
      }
      expect(query.value).toBe("f:artbook$");
      expect(focused.at(-1)).toBe(query);

      const name = editor.querySelector<HTMLInputElement>(".expression-name");
      if (!name) {
        throw new Error("missing expression name");
      }
      name.value = "Artbooks";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      editor
        .querySelector<HTMLFormElement>("form.expression-editor")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    } finally {
      proto.focus = originalFocus;
    }

    expect(panel.textContent).toContain("Artbooks");
    expect(panel.textContent).toContain("f:artbook$");

    const saved = panel.querySelector<HTMLButtonElement>(
      ".search-history-saved .search-history-query",
    );
    saved?.click();
    expect(searched).toEqual(["f:artbook$"]);
  });

  test("persists the seeded row when it is saved without a name", () => {
    input().value = "f:artbook$";
    const panel = openHistory();

    const editor = openEditor(panel);
    editor
      .querySelector<HTMLFormElement>("form.expression-editor")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(panel.querySelector(".search-history-saved")?.textContent).toContain("f:artbook$");
  });

  test("clears recent searches without touching saved ones", () => {
    input().value = "english";
    host
      .querySelector<HTMLFormElement>(".topbar-search")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    let panel = openHistory();
    saveCurrent(panel, "Language");

    panel.querySelector<HTMLButtonElement>(".search-history-clear")?.click();
    panel = historyPanel();
    expect(panel.textContent).not.toContain("Recent");
    expect(panel.textContent).toContain("Language");
  });

  test("removes a saved search and keeps the empty state honest", () => {
    input().value = "english";
    let panel = openHistory();
    saveCurrent(panel, "Lang");

    panel.querySelector<HTMLButtonElement>(".search-history-remove")?.click();
    panel = historyPanel();
    expect(panel.querySelector(".search-history-saved")).toBeNull();
    expect(panel.querySelector(".search-history-empty")).not.toBeNull();
  });

  test("saves a pinned toggle expression and applies its terms", () => {
    input().value = "f:keyword$";
    input().dispatchEvent(new Event("input", { bubbles: true }));

    let panel = openHistory();
    saveCurrent(panel, "TAGS", { mode: 1, pin: true });

    panel = historyPanel();
    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    // A toggle expression's row does what the expression says.
    panel.querySelector<HTMLButtonElement>(".search-history-saved .search-history-query")?.click();

    expect(searched).toEqual(["cat f:keyword$"]);
  });

  test("a run expression's row replaces the search, and its button toggles instead", () => {
    input().value = "f:keyword$";
    input().dispatchEvent(new Event("input", { bubbles: true }));

    let panel = openHistory();
    saveCurrent(panel, "TAGS", { mode: 0 });

    panel = historyPanel();
    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLButtonElement>(".search-history-saved .search-history-query")?.click();
    expect(searched).toEqual(["f:keyword$"]);

    // The row closed the panel and the field now holds the query; type a fresh draft and reopen.
    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    panel = openHistory();
    panel.querySelector<HTMLButtonElement>(".search-history-toggle")?.click();
    expect(searched).toEqual(["f:keyword$", "cat f:keyword$"]);
  });
});
