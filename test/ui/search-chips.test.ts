import { beforeEach, describe, expect, test } from "bun:test";

import { renderSearchChips } from "../../src/ui/search-chips";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

function labels(row: HTMLElement): string[] {
  return [...row.querySelectorAll(".term-value")].map((node) => node.textContent);
}

describe("search filter chips", () => {
  test("renders each term with its namespace and sign", () => {
    const sends: string[] = [];
    const row = renderSearchChips('female:"big brevity$" -male:term cat', (text) => {
      sends.push(text);
    });

    expect(row).not.toBeNull();
    if (!row) {
      return;
    }
    expect(labels(row)).toEqual(["big brevity", "term", "cat"]);

    const chips = row.querySelectorAll(".term-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0]?.querySelector(".term-ns")?.textContent).toBe("Female");
    expect(chips[1]?.classList.contains("is-excluded")).toBe(true);
    expect(chips[1]?.querySelector(".term-sign")?.textContent).toBe("−");
    expect(chips[2]?.querySelector(".term-ns")).toBeNull();

    chips[0]?.querySelector<HTMLButtonElement>(".term-toggle")?.click();
    expect(sends).toEqual(["-male:term cat"]);
  });

  test("resolves short namespace aliases but labels the tag value on its own", () => {
    const row = renderSearchChips('l:"chinese$"', () => undefined);
    if (!row) {
      throw new Error("expected chips");
    }

    expect(row.querySelector(".term-ns")?.textContent).toBe("Language");
    expect(labels(row)).toEqual(["chinese"]);
  });

  test("clicking a chip removes that term and keeps the others", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips('female:"big brevity$" -male:term cat', (text, action) => {
      edits.push({ text, type: action.type });
    });
    const chips = row?.querySelectorAll(".term-chip");

    chips?.[1]?.querySelector<HTMLButtonElement>(".term-toggle")?.click();
    expect(edits).toEqual([{ text: 'female:"big brevity$" cat', type: "remove" }]);
  });

  test("excluding a term is the menu action, not the click", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips("male:term cat", (text, action) => {
      edits.push({ text, type: action.type });
    });
    const toggle = row?.querySelector<HTMLButtonElement>(".term-toggle");

    toggle?.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
    const exclude = [...document.querySelectorAll<HTMLButtonElement>(".action-menu-item")].find(
      (item) => item.textContent === "Exclude from search",
    );
    exclude?.click();

    expect(edits).toEqual([{ text: "-male:term cat", type: "toggle" }]);
  });

  test("opens a sign and remove menu on right-click", () => {
    const edits: Array<{ text: string; type: string }> = [];
    const row = renderSearchChips("-male:term cat", (text, action) => {
      edits.push({ text, type: action.type });
    });
    const toggle = row?.querySelector<HTMLButtonElement>(".term-toggle");

    const opened = toggle?.dispatchEvent(
      new Event("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(opened).toBe(false);

    const items = [...document.querySelectorAll<HTMLButtonElement>(".action-menu-item")];
    expect(items.map((item) => item.textContent)).toEqual([
      "Include in search",
      "Make optional (OR)",
      "Remove",
    ]);

    items[0]?.click();
    expect(edits).toEqual([{ text: "male:term cat", type: "toggle" }]);
  });

  test("clears the whole search", () => {
    const sends: string[] = [];
    const row = renderSearchChips("one two", (text) => {
      sends.push(text);
    });

    row?.querySelector<HTMLButtonElement>(".search-filters-clear")?.click();
    expect(sends).toEqual([""]);
  });

  test("shows unknown namespaces as plain text", () => {
    const row = renderSearchChips("anime:foo", () => undefined);
    const chip = row?.querySelector(".term-chip");

    expect(chip?.querySelector(".term-ns")).toBeNull();
    expect(chip?.querySelector(".term-value")?.textContent).toBe("anime:foo");
  });

  test("renders quoted free text", () => {
    const row = renderSearchChips('"big brevity"', () => undefined);
    if (!row) {
      throw new Error("expected chips");
    }
    expect(labels(row)).toEqual(["big brevity"]);
    expect(row.querySelector(".term-ns")).toBeNull();
  });

  test("renders nothing for an empty query", () => {
    expect(renderSearchChips("   ", () => undefined)).toBeNull();
  });
});
