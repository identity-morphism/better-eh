import { describe, expect, test } from "bun:test";

import { parseFavorites } from "../../src/parse/favorites";
import { loadFixture } from "../dom";

const FAVORITES_URL = "https://exhentai.org/favorites.php?favcat=1";

const doc = await loadFixture("favorites.html");
const data = parseFavorites(doc, FAVORITES_URL);

describe("parseFavorites", () => {
  test("reads the folder tabs with counts and the active tab", () => {
    expect(data.folders).toEqual([
      { slot: 0, name: "Good Stuff", count: 1207 },
      { slot: 1, name: "Plan to Read", count: 46 },
      { slot: 2, name: "Good Read", count: 49 },
    ]);
    expect(data.active).toBe(1);
  });

  test("reads the order control", () => {
    expect(data.order).toBe("published");
  });

  test("parses the favorite cards through the shared list parser", () => {
    expect(data.items.map((item) => item.gid)).toEqual(["101", "102", "103", "104"]);
    expect(data.items.map((item) => item.pages)).toEqual([31, 10, 5, 120]);
  });

  test("collects saved notes by gallery id and skips empty ones", () => {
    expect([...data.notes]).toEqual([["102", "Read later"]]);
  });

  test("resolves the pager cursors and leaves the result summary empty", () => {
    expect(data.nextHref).toBe("https://exhentai.org/favorites.php?next=104-0");
    expect(data.prevHref).toBe("https://exhentai.org/favorites.php?prev=1-0");
    expect(data.summary).toBeNull();
  });
});
