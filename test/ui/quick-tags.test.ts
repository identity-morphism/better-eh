import { beforeEach, describe, expect, test } from "bun:test";

import { type QuickTag, quickTags, replaceQuickTags } from "../../src/data/quick-tags";
import { updateSetting } from "../../src/settings";
import { closePopovers } from "../../src/ui/popover";
import { renderQuickTags } from "../../src/ui/quick-tags";
import { installDom } from "./dom";

function tag(patch: Partial<QuickTag> = {}): QuickTag {
  return {
    name: "LOLI",
    query: "f:lolicon$",
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
  test("saves an edited quick tag and applies it to the draft", () => {
    const applied: string[] = [];
    const handle = renderQuickTags({
      getText: () => "cat",
      apply: (text) => applied.push(text),
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();

    const panel = document.querySelector(".quick-tag-editor-panel");
    if (!panel) {
      throw new Error("editor did not open");
    }
    // Quick tags only toggle, so the editor has no run/toggle or pin controls.
    expect(panel.querySelector("select")).toBeNull();
    expect(panel.querySelector("input[type='checkbox']")).toBeNull();

    const add = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "+ Add",
    );
    add?.click();

    const name = panel.querySelector<HTMLInputElement>(".quick-tag-name");
    const query = panel.querySelector<HTMLInputElement>(".quick-tag-query");
    if (!name || !query) {
      throw new Error("editor row missing");
    }
    name.value = "LOLI";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    query.value = "f:lolicon$";
    query.dispatchEvent(new Event("input", { bubbles: true }));

    const form = panel.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(document.querySelector(".quick-tag-editor-panel")).toBeNull();
    expect(quickTags()).toMatchObject([{ name: "LOLI", query: "f:lolicon$" }]);

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("LOLI");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    pill?.click();
    expect(applied).toEqual(["cat f:lolicon$"]);
  });

  test("a click toggles the terms in and back out", () => {
    replaceQuickTags([tag()]);
    const applied: string[] = [];
    let draft = "cat";
    const handle = renderQuickTags({
      getText: () => draft,
      apply: (text) => {
        applied.push(text);
        draft = text;
      },
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    pill?.click();
    pill?.click();

    expect(applied).toEqual(["cat f:lolicon$", "cat"]);
  });

  test("restores quick tags in a later view and marks them active", () => {
    replaceQuickTags([tag()]);

    const handle = renderQuickTags({
      getText: () => "f:lolicon$ other",
      apply: () => undefined,
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("LOLI");
    expect(pill?.getAttribute("aria-pressed")).toBe("true");

    handle.refresh("other");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");
  });

  test("offers tag suggestions while editing a quick tag", () => {
    updateSetting("tagSuggestions", true);
    replaceQuickTags([tag()]);
    const handle = renderQuickTags({
      getText: () => "",
      apply: () => undefined,
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();
    const panel = document.querySelector(".quick-tag-editor-panel");
    const query = panel?.querySelector<HTMLInputElement>(".quick-tag-query");
    if (!query) {
      throw new Error("quick tag query missing");
    }
    expect(query.getAttribute("role")).toBe("combobox");

    // The embedded vocabulary answers synchronously; keep the background refresh offline.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      query.focus();
      query.value = "big bre";
      query.dispatchEvent(new Event("input", { bubbles: true }));

      const first = document.querySelector<HTMLElement>(".tag-option .tag-option-key");
      expect(first?.textContent).toBe("big breasts");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("removes a quick tag through the editor", () => {
    replaceQuickTags([tag()]);
    const handle = renderQuickTags({
      getText: () => "",
      apply: () => undefined,
      signal: new AbortController().signal,
    });

    handle.element.querySelector<HTMLButtonElement>(".quick-tag-edit")?.click();
    const panel = document.querySelector(".quick-tag-editor-panel");
    panel?.querySelector<HTMLButtonElement>(".quick-tag-remove")?.click();
    const form = panel?.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(quickTags()).toEqual([]);
    expect(handle.element.querySelector(".quick-tag")).toBeNull();
  });
});
