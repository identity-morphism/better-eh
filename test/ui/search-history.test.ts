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
  GM_setValue("eh:quick-tags:v1", null);
  GM_setValue("eh:saved-searches:v1", null);
  setSearchQuery(emptySearchQuery());
  host = mountHost();
  searched = [];
  render();
});

describe("search history panel", () => {
  test("records a submitted query and re-runs it from the panel", () => {
    input().value = "big breasts";
    host
      .querySelector<HTMLFormElement>(".topbar-search")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(searched).toEqual(["big breasts"]);

    const panel = openHistory();
    expect(panel.textContent).toContain("big breasts");

    const entry = [...panel.querySelectorAll<HTMLButtonElement>(".search-history-query")].find(
      (button) => button.textContent.includes("big breasts"),
    );
    entry?.click();
    expect(searched).toEqual(["big breasts", "big breasts"]);
  });

  test("seeds the editor with the current query and saves it as a quick tag", () => {
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

      const name = editor.querySelector<HTMLInputElement>(".quick-tag-name");
      if (!name) {
        throw new Error("missing quick tag name");
      }
      name.value = "Artbooks";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      editor
        .querySelector<HTMLFormElement>("form.quick-tag-editor")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    } finally {
      proto.focus = originalFocus;
    }

    expect(panel.textContent).toContain("Artbooks");
    expect(panel.textContent).toContain("f:artbook$");

    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    panel
      .querySelector<HTMLButtonElement>(".search-history-quick-tag .search-history-query")
      ?.click();
    expect(searched).toEqual(["cat f:artbook$"]);
  });

  test("persists the seeded row when it is saved without a name", () => {
    input().value = "f:artbook$";
    const panel = openHistory();

    const editor = openEditor(panel);
    editor
      .querySelector<HTMLFormElement>("form.quick-tag-editor")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(panel.querySelector(".search-history-quick-tag")?.textContent).toContain("f:artbook$");
  });

  test("clears recent searches without touching quick tags", () => {
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

  test("removes a quick tag and keeps the empty state honest", () => {
    input().value = "english";
    let panel = openHistory();
    saveCurrent(panel, "Lang");

    panel.querySelector<HTMLButtonElement>(".search-history-remove")?.click();
    panel = historyPanel();
    expect(panel.querySelector(".search-history-quick-tag")).toBeNull();
    expect(panel.querySelector(".search-history-empty")).not.toBeNull();
  });

  test("quick tags add and remove their terms instead of running a search", () => {
    input().value = "f:lolicon$";
    input().dispatchEvent(new Event("input", { bubbles: true }));

    let panel = openHistory();
    saveCurrent(panel, "LOLI");

    panel = historyPanel();
    // There is no run/toggle switch: a quick tag always toggles its terms.
    expect(panel.querySelector(".search-history-toggle")).toBeNull();

    input().value = "cat";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    panel
      .querySelector<HTMLButtonElement>(".search-history-quick-tag .search-history-query")
      ?.click();
    expect(searched).toEqual(["cat f:lolicon$"]);

    input().value = "cat f:lolicon$";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    panel = openHistory();
    panel
      .querySelector<HTMLButtonElement>(".search-history-quick-tag .search-history-query")
      ?.click();
    expect(searched).toEqual(["cat f:lolicon$", "cat"]);
  });
});
