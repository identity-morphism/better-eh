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

  test("extends a shift range from the anchor, forward and backward", () => {
    const selection = sample();

    // No anchor yet: a shift toggle is a plain toggle and becomes the anchor.
    selection.toggle("102", { shift: true });
    expect(selection.ids()).toEqual(["102"]);

    selection.toggle("104", { shift: true });
    expect(selection.ids()).toEqual(["102", "103", "104"]);

    // The range's target becomes the new anchor, so the next shift extends back across it.
    selection.toggle("101", { shift: true });
    expect(selection.ids()).toEqual(["101", "102", "103", "104"]);
    expect(selection.all).toBe(true);
  });

  test("selects all, clears, and resets the anchor", () => {
    const selection = sample();

    selection.setAll(true);
    expect(selection.all).toBe(true);
    expect(selection.some).toBe(true);
    expect(selection.ids()).toEqual(GIDS);

    selection.toggle("102");
    expect(selection.all).toBe(false);
    expect(selection.some).toBe(true);

    selection.setAll(false);
    expect(selection.some).toBe(false);
    expect(selection.size).toBe(0);

    // clear() and select-all both reset the anchor.
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

    const empty = createSelection([]);
    empty.setAll(true);
    expect(empty.all).toBe(false);
    expect(empty.size).toBe(0);
  });

  test("notifies once per mutation and ignores gids that are not on the page", () => {
    const selection = sample();
    let calls = 0;

    const unsubscribe = selection.subscribe(() => {
      calls += 1;
    });

    selection.toggle("101");
    selection.toggle("104", { shift: true });
    selection.setAll(true);
    selection.clear();
    expect(calls).toBe(4);

    selection.toggle("999");
    selection.toggle("999", { shift: true });
    expect(selection.size).toBe(0);
    expect(calls).toBe(4);

    unsubscribe();
    selection.toggle("102");
    selection.clear();
    expect(calls).toBe(4);
  });
});
