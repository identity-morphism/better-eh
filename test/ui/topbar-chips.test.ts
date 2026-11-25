import { beforeEach, describe, expect, test } from "bun:test";

import { HTMLElement as LinkedomElement } from "linkedom";

import { emptySearchQuery } from "../../src/parse/query";
import { setSearchQuery } from "../../src/search-draft";
import { updateSetting } from "../../src/settings";
import { renderTopbar } from "../../src/ui/topbar";
import { installDom, mountHost } from "./dom";
import { installFrameQueue } from "./frames";

let host: HTMLElement;
let focused: Element[];
let view: AbortController | null = null;

beforeEach(() => {
  view?.abort();
  view = new AbortController();
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
      signal: view.signal,
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
  test("removal moves focus to the next chip, then the previous, then the field", () => {
    chips()[0]?.click();
    expect(lastFocus()).toBe("two");

    chips()[1]?.click();
    expect(lastFocus()).toBe("two");

    chips()[0]?.click();
    expect(focused.at(-1)?.tagName).toBe("INPUT");
  });

  test("a chip edit draws before focus moves even when frames are queued", () => {
    const frames = installFrameQueue();
    try {
      chips()[0]?.click();
      expect(lastFocus()).toBe("two");
      expect(chips()[0]?.querySelector(".term-value")?.textContent).toBe("two");
      expect(frames.pending.size).toBe(0);
    } finally {
      frames.restore();
    }
  });

  test("coalesces keystrokes into one frame and reuses unchanged chips", () => {
    const frames = installFrameQueue();
    try {
      const input = host.querySelector<HTMLInputElement>('input[name="f_search"]');
      if (!input) {
        throw new Error("missing search input");
      }
      const first = chips()[0];
      input.value = "one two three four";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.value = "one two three four five";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      // Nothing redraws until the frame, and the two input events share one.
      expect(frames.pending.size).toBe(1);
      expect(chips()).toHaveLength(3);
      expect(host.querySelector(".topbar-filters")?.hasAttribute("hidden")).toBe(false);

      frames.run();
      expect(chips()).toHaveLength(5);
      expect(chips()[0]).toBe(first);

      // The same term set with different whitespace points at the same chips.
      input.value = "one two three four five ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      frames.run();
      expect(chips()[0]).toBe(first);
      expect(chips()).toHaveLength(5);

      // Clearing queues an empty row but hides it at once.
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(host.querySelector(".topbar-filters")?.hasAttribute("hidden")).toBe(true);
      frames.run();
      expect(chips()).toHaveLength(0);
    } finally {
      frames.restore();
    }
  });
});
