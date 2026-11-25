import { beforeEach, describe, expect, test } from "bun:test";

import { renderSearchChips } from "../../src/ui/search-chips";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

function toggles(row: HTMLElement): HTMLButtonElement[] {
  return [...row.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];
}

describe("search filter chips", () => {
  test("renders each term with its label, namespace and accessible state", () => {
    const row = renderSearchChips(
      'female:"big breasts$" -male:dilf anime:foo "big breasts"',
      () => undefined,
    );
    if (!row) {
      throw new Error("expected chips");
    }

    const buttons = toggles(row);
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.getAttribute("aria-label")).toContain("big breasts, included.");
    expect(buttons[1]?.getAttribute("aria-label")).toContain("dilf, excluded.");
    // An unknown namespace stays part of the visible term instead of being split off.
    expect(buttons[2]?.getAttribute("aria-label")).toContain("anime:foo, included.");
    expect(buttons[3]?.getAttribute("aria-label")).toContain("big breasts, included.");

    const text = row.textContent;
    expect(text).toContain("Female");
    expect(text).toContain("big breasts");
    expect(text).toContain("anime:foo");
  });

  test("clicking a chip removes that term and keeps the others", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips('female:"big breasts$" -male:dilf cat', (text, action) => {
      edits.push({ text, type: action.type });
    });

    toggles(row as HTMLElement)[1]?.click();
    expect(edits).toEqual([{ text: 'female:"big breasts$" cat', type: "remove" }]);
  });

  test("right-clicking a chip changes its sign instead of removing it", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips("male:dilf cat", (text, action) => {
      edits.push({ text, type: action.type });
    });

    const opened = toggles(row as HTMLElement)[0]?.dispatchEvent(
      new Event("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(opened).toBe(false);

    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Exclude from search",
      "Make optional (OR)",
      "Remove",
    ]);
    items[0]?.click();
    expect(edits).toEqual([{ text: "-male:dilf cat", type: "toggle" }]);
  });

  test("clears the whole search, and an empty query renders no row", () => {
    const sends: string[] = [];
    const row = renderSearchChips("one two", (text) => {
      sends.push(text);
    });

    row?.querySelector<HTMLButtonElement>(".search-filters-clear")?.click();
    expect(sends).toEqual([""]);
    expect(renderSearchChips("   ", () => undefined)).toBeNull();
  });
});
