import { beforeEach, describe, expect, test } from "bun:test";

import { closePopovers } from "../../src/ui/popover";
import { createSearchChips } from "../../src/ui/search-chips";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

/** One-shot row used by the view tests; production always keeps the handle. */
function renderSearchChips(
  text: string,
  onSearch: Parameters<typeof createSearchChips>[0],
  signal?: AbortSignal,
): HTMLElement | null {
  const chips = createSearchChips(onSearch, signal);
  if (chips.update(text)) {
    return chips.element;
  }
  chips.destroy();
  return null;
}

function toggles(row: HTMLElement): HTMLButtonElement[] {
  return [...row.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];
}

describe("search filter chips", () => {
  test("renders each term with its label, namespace and accessible state", () => {
    const row = renderSearchChips(
      'female:"big brevity$" -male:term anime:foo "big brevity"',
      () => undefined,
    );
    if (!row) {
      throw new Error("expected chips");
    }

    const buttons = toggles(row);
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.getAttribute("aria-label")).toContain("big brevity, included.");
    expect(buttons[1]?.getAttribute("aria-label")).toContain("term, excluded.");
    // An unknown namespace stays part of the visible term instead of being split off.
    expect(buttons[2]?.getAttribute("aria-label")).toContain("anime:foo, included.");
    expect(buttons[3]?.getAttribute("aria-label")).toContain("big brevity, included.");

    const text = row.textContent;
    expect(text).toContain("Female");
    expect(text).toContain("big brevity");
    expect(text).toContain("anime:foo");
  });

  test("clicking a chip removes that term and keeps the others", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips('female:"big brevity$" -male:term cat', (text, action) => {
      edits.push({ text, type: action.type });
    });

    toggles(row as HTMLElement)[1]?.click();
    expect(edits).toEqual([{ text: 'female:"big brevity$" cat', type: "remove" }]);
  });

  test("right-clicking a chip changes its sign instead of removing it", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips("male:term cat", (text, action) => {
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
    expect(edits).toEqual([{ text: "-male:term cat", type: "toggle" }]);
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

describe("search filter reconciliation", () => {
  test("reuses unchanged chips and keeps their edits on the live text", () => {
    const edits: Array<{ text: string; index: number }> = [];
    const chips = createSearchChips((text, action) => {
      if (action.type !== "clear") {
        edits.push({ text, index: action.index });
      }
    });
    expect(chips.update("one two three")).toBe(true);

    const row = chips.element;
    const [first, second] = toggles(row);
    if (!first || !second) {
      throw new Error("expected chips");
    }

    chips.update("one two three ");
    expect(toggles(row)[0]).toBe(first);
    expect(toggles(row)[1]).toBe(second);

    chips.update("one two three four");
    expect(toggles(row)[0]).toBe(first);
    expect(toggles(row)[1]).toBe(second);
    expect(toggles(row)).toHaveLength(4);

    // Dropping the first chip reuses the suffix; a reorder reuses the same nodes.
    const four = toggles(row)[3];
    chips.update("two three four");
    expect(toggles(row)[0]).toBe(second);
    chips.update("four two");
    expect(toggles(row)[0]).toBe(four);
    expect(toggles(row).map((node) => node.querySelector(".term-value")?.textContent)).toEqual([
      "four",
      "two",
    ]);
    expect(toggles(row)[1]).toBe(second);

    // Reused chips still open their context menu after the rebuild.
    const opened = toggles(row)[1]?.dispatchEvent(
      new Event("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(opened).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (node) => node.textContent,
      ),
    ).toContain("Remove");
    closePopovers();

    // Same rendered chips, new source offsets: the click must remove the live term.
    chips.update("one  two three four");
    toggles(row)[1]?.click();
    expect(edits.at(-1)).toEqual({ text: "one three four", index: 1 });

    expect(chips.update("")).toBe(false);
    expect(toggles(row)).toHaveLength(0);
    chips.destroy();
  });
});
