import { beforeEach, describe, expect, test } from "bun:test";

import {
  replaceExpressions,
  type SavedExpression,
  savedExpressions,
} from "../../src/data/saved-expressions";
import { updateSetting } from "../../src/settings";
import { closePopovers } from "../../src/ui/popover";
import { renderQuickTags } from "../../src/ui/quick-tags";
import { installDom } from "./dom";

function expression(patch: Partial<SavedExpression> = {}): SavedExpression {
  return {
    name: "TAGS",
    query: "f:keyword$",
    mode: "run",
    pinned: true,
    savedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  closePopovers();
  installDom();
  updateSetting("tagSuggestions", false);
  GM_setValue("eh:saved-expressions:v1", []);
  GM_setValue("eh:quick-tags:v1", null);
  GM_setValue("eh:saved-searches:v1", null);
});

function submit(form: Element): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("quick tags", () => {
  test("saves an edited expression and applies it to the draft", () => {
    const searched: string[] = [];
    const handle = renderQuickTags({
      getText: () => "cat",
      search: (text) => searched.push(text),
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();

    const panel = document.querySelector(".expression-editor-panel");
    if (!panel) {
      throw new Error("editor did not open");
    }
    const add = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "+ Add",
    );
    add?.click();

    const name = panel.querySelector<HTMLInputElement>(".expression-name");
    const query = panel.querySelector<HTMLInputElement>(".expression-query");
    const pin = panel.querySelector<HTMLInputElement>(".expression-pin input");
    if (!name || !query || !pin) {
      throw new Error("editor row missing");
    }
    name.value = "TAGS";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    query.value = "f:keyword$";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    pin.checked = true;
    pin.dispatchEvent(new Event("change", { bubbles: true }));

    const form = panel.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(document.querySelector(".expression-editor-panel")).toBeNull();
    expect(savedExpressions()).toMatchObject([
      { name: "TAGS", query: "f:keyword$", mode: "toggle", pinned: true },
    ]);

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("TAGS");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    pill?.click();
    expect(searched).toEqual(["cat f:keyword$"]);
  });

  test("a click always toggles the terms, ignoring Alt", () => {
    replaceExpressions([expression()]);
    const searched: string[] = [];
    let draft = "cat";
    const handle = renderQuickTags({
      getText: () => draft,
      search: (text) => {
        searched.push(text);
        draft = text;
      },
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    pill?.click();
    const alt = new Event("click", { bubbles: true, cancelable: true });
    Object.assign(alt, { altKey: true });
    pill?.dispatchEvent(alt);

    expect(searched).toEqual(["cat f:keyword$", "cat"]);
  });

  test("restores pinned expressions in a later view and marks them active", () => {
    replaceExpressions([expression({ mode: "toggle" })]);

    const handle = renderQuickTags({
      getText: () => "f:keyword$ other",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("TAGS");
    expect(pill?.getAttribute("aria-pressed")).toBe("true");

    handle.refresh("other");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");
  });

  test("unpinned expressions stay out of the chip row", () => {
    replaceExpressions([expression({ pinned: false })]);

    const handle = renderQuickTags({
      getText: () => "",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    expect(handle.element.querySelector(".quick-tag")).toBeNull();
  });

  test("switching a quick tag to run unpins it", () => {
    replaceExpressions([expression({ mode: "toggle" })]);
    const handle = renderQuickTags({
      getText: () => "",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();
    const panel = document.querySelector(".expression-editor-panel");
    if (!panel) {
      throw new Error("editor did not open");
    }

    const mode = panel.querySelector<HTMLSelectElement>(".expression-mode");
    if (!mode) {
      throw new Error("editor mode select missing");
    }
    mode.selectedIndex = 0;
    mode.dispatchEvent(new Event("change", { bubbles: true }));

    const pin = panel.querySelector<HTMLInputElement>(".expression-pin input");
    expect(pin?.checked).toBe(false);

    const form = panel.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(savedExpressions()).toMatchObject([{ mode: "run", pinned: false }]);
    expect(handle.element.querySelector(".quick-tag")).toBeNull();
  });

  test("offers tag suggestions while editing an expression query", () => {
    updateSetting("tagSuggestions", true);
    replaceExpressions([expression({ mode: "toggle" })]);
    const handle = renderQuickTags({
      getText: () => "",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();
    const panel = document.querySelector(".expression-editor-panel");
    const query = panel?.querySelector<HTMLInputElement>(".expression-query");
    if (!query) {
      throw new Error("expression query missing");
    }
    expect(query.getAttribute("role")).toBe("combobox");

    // The embedded vocabulary answers synchronously; keep the background refresh offline.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      query.focus();
      query.value = "sole fem";
      query.dispatchEvent(new Event("input", { bubbles: true }));

      const first = document.querySelector<HTMLElement>(".tag-option .tag-option-key");
      expect(first?.textContent).toBe("sole female");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("removes an expression through the editor", () => {
    replaceExpressions([expression()]);
    const handle = renderQuickTags({
      getText: () => "",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();
    const panel = document.querySelector(".expression-editor-panel");
    panel?.querySelector<HTMLButtonElement>(".expression-remove")?.click();
    const form = panel?.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(savedExpressions()).toEqual([]);
    expect(handle.element.querySelector(".quick-tag")).toBeNull();
  });
});
