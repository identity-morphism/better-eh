import { beforeEach, describe, expect, test } from "bun:test";

import { type QuickTag, quickTags, replaceQuickTags } from "../../src/data/quick-tags";
import { updateSetting } from "../../src/settings";
import { closePopovers } from "../../src/ui/popover";
import { renderQuickTags } from "../../src/ui/quick-tags";
import { installDom } from "./dom";

function tag(patch: Partial<QuickTag> = {}): QuickTag {
  return {
    name: "TAGS",
    query: "f:keyword$",
    savedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  closePopovers();
  installDom();
  updateSetting("tagSuggestions", false);
  GM_setValue("eh:saved-expressions:v1", []);
});

function submit(form: Element): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function buttonText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}

describe("quick tags", () => {
  test("adds and removes rows through the editor", () => {
    const handle = renderQuickTags({
      getText: () => "",
      apply: () => undefined,
      signal: new AbortController().signal,
    });

    buttonText(handle.element, "+ Quick tags")?.click();
    const panel = document.querySelector(".quick-tag-editor-panel");
    if (!panel) {
      throw new Error("editor did not open");
    }
    buttonText(panel, "+ Add")?.click();

    const name = panel.querySelector<HTMLInputElement>(".quick-tag-name");
    const query = panel.querySelector<HTMLInputElement>(".quick-tag-query");
    const form = panel.querySelector("form");
    if (!name || !query || !form) {
      throw new Error("editor row missing");
    }
    name.value = "TAGS";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    query.value = "f:keyword$";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    submit(form);

    expect(document.querySelector(".quick-tag-editor-panel")).toBeNull();
    expect(quickTags()).toMatchObject([{ name: "TAGS", query: "f:keyword$" }]);
    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("TAGS");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    buttonText(handle.element, "Edit tags")?.click();
    const reopened = document.querySelector(".quick-tag-editor-panel");
    reopened?.querySelector<HTMLButtonElement>(".quick-tag-remove")?.click();
    const reopenedForm = reopened?.querySelector("form");
    if (!reopenedForm) {
      throw new Error("editor form missing");
    }
    submit(reopenedForm);

    expect(quickTags()).toEqual([]);
    expect(handle.element.querySelector(".quick-tag")).toBeNull();
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
    pill?.click();
    pill?.click();

    expect(applied).toEqual(["cat f:keyword$", "cat"]);
  });

  test("restores quick tags in a later view and marks them active", () => {
    replaceQuickTags([tag()]);

    const handle = renderQuickTags({
      getText: () => "f:keyword$ other",
      apply: () => undefined,
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("TAGS");
    expect(pill?.getAttribute("aria-pressed")).toBe("true");

    handle.refresh("other");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");
    // A repaint with the same draft leaves the button untouched.
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
      query.value = "sole fem";
      query.dispatchEvent(new Event("input", { bubbles: true }));

      const first = document.querySelector<HTMLElement>(".tag-option .tag-option-key");
      expect(first?.textContent).toBe("sole female");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
