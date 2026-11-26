import { expect, test } from "bun:test";

import type { FavoriteFolder } from "../../src/data/favorites";
import { createFavoriteState } from "../../src/ui/favorite-state";

const folder: FavoriteFolder = { slot: 2, name: "Keep", color: "#ffffff" };

test("a completed change wins over the cached page's mark", () => {
  createFavoriteState({ gid: "1", token: "t" }, null, true).set(true, folder);

  const later = createFavoriteState({ gid: "1", token: "t" }, null, true);

  expect(later.get()).toEqual({ favorited: true, folder: "Keep", slot: 2 });
});

test("a removal also survives the cached page's mark", () => {
  createFavoriteState({ gid: "2", token: "t" }, { folder: "Keep", slot: 2 }, true).set(false, null);

  const later = createFavoriteState({ gid: "2", token: "t" }, { folder: "Keep", slot: 2 }, true);

  expect(later.get()).toEqual({ favorited: false, folder: null, slot: null });
});

test("galleries do not share a mark", () => {
  createFavoriteState({ gid: "3", token: "t" }, null, true).set(true, folder);

  const other = createFavoriteState({ gid: "4", token: "t" }, null, true);

  expect(other.get().favorited).toBe(false);
});
