import { describe, expect, test } from "bun:test";

import { createSelection } from "../../src/views/favorites-selection";
import type { FavoritesSelection } from "../../src/views/favorites-selection";

const GIDS = ["101", "102", "103", "104"];

function sample(): FavoritesSelection {
  return createSelection(GIDS);
}

describe("favorites selection", () => {
  test("toggles one gid and reports ids in source order", () => {
    const selection = sample();

    selection.toggle("103");
    selection.toggle("101");

    expect(selection.has("103")).toBe(true);
    expect(selection.has("102")).toBe(false);
    expect(selection.ids()).toEqual(["101", "103"]);
    expect(selection.size).toBe(2);
    expect(selection.some).toBe(true);
    expect(selection.all).toBe(false);

    selection.toggle("101");

    expect(selection.ids()).toEqual(["103"]);
    expect(selection.size).toBe(1);
  });

  test("extends a shift range forward and backward from the anchor", () => {
    const selection = sample();

    selection.toggle("102");
    selection.toggle("104", { shift: true });
    expect(selection.ids()).toEqual(["102", "103", "104"]);

    // The range's target becomes the new anchor, so the next shift extends back across it.
    selection.toggle("101", { shift: true });
    expect(selection.ids()).toEqual(["101", "102", "103", "104"]);
    expect(selection.all).toBe(true);
  });

  test("treats a shift toggle with no anchor as a plain toggle", () => {
    const selection = sample();

    selection.toggle("102", { shift: true });
    expect(selection.ids()).toEqual(["102"]);

    selection.toggle("104", { shift: true });
    expect(selection.ids()).toEqual(["102", "103", "104"]);
  });

  test("derives select-all and some, and clears them", () => {
    const selection = sample();

    selection.setAll(true);
    expect(selection.all).toBe(true);
    expect(selection.some).toBe(true);
    expect(selection.ids()).toEqual(GIDS);

    selection.toggle("102");
    expect(selection.all).toBe(false);
    expect(selection.some).toBe(true);
    expect(selection.size).toBe(3);

    selection.setAll(false);
    expect(selection.all).toBe(false);
    expect(selection.some).toBe(false);
    expect(selection.size).toBe(0);
    expect(selection.ids()).toEqual([]);
  });

  test("resets the anchor on clear and on select-all", () => {
    const selection = sample();

    selection.toggle("101");
    selection.toggle("103", { shift: true });
    expect(selection.ids()).toEqual(["101", "102", "103"]);

    selection.clear();
    selection.toggle("104", { shift: true });
    expect(selection.ids()).toEqual(["104"]);

    selection.setAll(true);
    selection.setAll(false);
    selection.toggle("102", { shift: true });
    expect(selection.ids()).toEqual(["102"]);
  });

  test("notifies once per mutation, and not after unsubscribe", () => {
    const selection = sample();
    let calls = 0;

    const unsubscribe = selection.subscribe(() => {
      calls += 1;
    });

    selection.toggle("101");
    expect(calls).toBe(1);

    selection.toggle("104", { shift: true });
    expect(calls).toBe(2);

    selection.setAll(true);
    expect(calls).toBe(3);

    selection.clear();
    expect(calls).toBe(4);

    unsubscribe();
    selection.toggle("102");
    selection.clear();
    expect(calls).toBe(4);
  });

  test("ignores gids that are not on the page", () => {
    const selection = sample();
    let calls = 0;
    selection.subscribe(() => {
      calls += 1;
    });

    selection.toggle("999");
    selection.toggle("999", { shift: true });

    expect(selection.size).toBe(0);
    expect(calls).toBe(0);
  });

  test("an empty page is never all-selected", () => {
    const selection = createSelection([]);

    expect(selection.all).toBe(false);
    expect(selection.some).toBe(false);
    selection.setAll(true);
    expect(selection.size).toBe(0);
    expect(selection.all).toBe(false);
  });
});
