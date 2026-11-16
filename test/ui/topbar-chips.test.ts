import { beforeEach, describe, expect, test } from "bun:test";

import { HTMLElement as LinkedomElement } from "linkedom";

import { emptySearchQuery } from "../../src/parse/query";
import { setSearchQuery } from "../../src/search-draft";
import { updateSetting } from "../../src/settings";
import { renderTopbar } from "../../src/ui/topbar";
import { installDom, mountHost } from "./dom";

let host: HTMLElement;
let focused: Element[];

beforeEach(() => {
  installDom();
  updateSetting("tagSuggestions", false);
  setSearchQuery({ ...emptySearchQuery(), text: "one two three" });
  focused = [];
  // linkedom does not track `activeElement`; record the element each focus call lands on.
  LinkedomElement.prototype.focus = function focus(this: Element): void {
    focused.push(this);
  };
  host = mountHost();
  host.append(
    renderTopbar({
      onSearch: () => undefined,
      draftChips: true,
      signal: new AbortController().signal,
    }),
  );
});

function chips(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(".term-toggle")];
}

function lastFocus(): string | null {
  const element = focused.at(-1);
  return element?.querySelector(".term-value")?.textContent ?? element?.tagName ?? null;
}

describe("topbar chip focus", () => {
  test("removing a chip focuses the chip that takes its place", () => {
    chips()[0]?.click();
    expect(lastFocus()).toBe("two");
  });

  test("removing the last chip focuses the previous one", () => {
    chips()[2]?.click();
    expect(lastFocus()).toBe("two");
  });

  test("only an empty row falls back to the search field", () => {
    chips()[0]?.click();
    chips()[0]?.click();
    chips()[0]?.click();
    expect(focused.at(-1)?.tagName).toBe("INPUT");
  });
});
