import { beforeEach, describe, expect, test } from "bun:test";

import {
  replaceExpressions,
  type SavedExpression,
  savedExpressions,
} from "../../src/data/saved-expressions";
import { closePopovers } from "../../src/ui/popover";
import { renderQuickTags } from "../../src/ui/quick-tags";
import { installDom } from "./dom";

function expression(patch: Partial<SavedExpression> = {}): SavedExpression {
  return {
    name: "LOLI",
    query: "f:lolicon$",
    mode: "run",
    pinned: true,
    savedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  closePopovers();
  installDom();
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
    name.value = "LOLI";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    query.value = "f:lolicon$";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    pin.checked = true;
    pin.dispatchEvent(new Event("change", { bubbles: true }));

    const mode = panel.querySelector<HTMLSelectElement>(".expression-mode");
    if (!mode) {
      throw new Error("editor mode select missing");
    }
    mode.selectedIndex = 1;
    mode.dispatchEvent(new Event("change", { bubbles: true }));

    const form = panel.querySelector("form");
    if (!form) {
      throw new Error("editor form missing");
    }
    submit(form);

    expect(document.querySelector(".expression-editor-panel")).toBeNull();
    expect(savedExpressions()).toMatchObject([
      { name: "LOLI", query: "f:lolicon$", mode: "toggle", pinned: true },
    ]);

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("LOLI");
    expect(pill?.getAttribute("aria-pressed")).toBe("false");

    pill?.click();
    expect(searched).toEqual(["cat f:lolicon$"]);
  });

  test("a run expression replaces the search, and Alt toggles its terms", () => {
    replaceExpressions([expression()]);
    const searched: string[] = [];
    const handle = renderQuickTags({
      getText: () => "cat",
      search: (text) => searched.push(text),
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    // A run expression has no on/off state to report.
    expect(pill?.getAttribute("aria-pressed")).toBeNull();

    pill?.click();
    const alt = new Event("click", { bubbles: true, cancelable: true });
    Object.assign(alt, { altKey: true });
    pill?.dispatchEvent(alt);

    expect(searched).toEqual(["f:lolicon$", "cat f:lolicon$"]);
  });

  test("restores pinned expressions in a later view and marks them active", () => {
    replaceExpressions([expression({ mode: "toggle" })]);

    const handle = renderQuickTags({
      getText: () => "f:lolicon$ other",
      search: () => undefined,
      signal: new AbortController().signal,
    });

    const pill = handle.element.querySelector<HTMLButtonElement>(".quick-tag");
    expect(pill?.textContent).toBe("LOLI");
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
