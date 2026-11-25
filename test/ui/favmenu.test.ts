import { beforeEach, describe, expect, test, vi } from "bun:test";

import type { FavoriteMark } from "../../src/types";
import { closeFavoriteMenu, createStatusRegion, openFavoriteMenu } from "../../src/ui/favmenu";
import type { FavoriteState } from "../../src/ui/favorite-state";
import { createFavoriteState } from "../../src/ui/favorite-state";
import { closePopovers } from "../../src/ui/popover";
import { flushMicrotasks } from "./async";
import { installDom } from "./dom";

const GALLERY_URL = "https://exhentai.org/g/101/aaaa/";

function favoriteState(mark: FavoriteMark | null, known = mark !== null) {
  return createFavoriteState({ gid: "101", token: "aaaa" }, mark, known);
}

let document: Document;

beforeEach(() => {
  closeFavoriteMenu();
  closePopovers();
  document = installDom();
  Object.assign(globalThis, { location: new URL(GALLERY_URL) });
});

describe("favorite menu status region", () => {
  test("keeps one role=status node and re-announces a repeated message", () => {
    const status = createStatusRegion();
    document.body.append(status.node);
    const node = status.node;

    expect(node.getAttribute("role")).toBe("status");
    expect(node.getAttribute("aria-live")).toBe("polite");

    status.announce("Loading folders…");
    status.announce("Saving…");
    expect(document.querySelector("[role='status']")).toBe(node);
    expect(node.textContent).toBe("Saving…");

    vi.useFakeTimers();
    try {
      status.announce("Favorite update failed");
      status.announce("Favorite update failed");

      expect(node.textContent).toBe("");
      expect(node.hidden).toBe(true);

      // The blank frame is restored on the next tick so assistive tech re-reads the message.
      vi.advanceTimersByTime(16);

      expect(node.textContent).toBe("Favorite update failed");
      expect(node.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("marks the current folder by slot, or by name when no slot is known", async () => {
    document.cookie = "ipb_member_id=1";
    const folders = [
      { slot: 1, name: "Good Stuff", color: "#c8c8c8" },
      { slot: 2, name: "Plan to Read", color: "#ff7b7b" },
    ];
    const openWith = async (state: FavoriteState) => {
      const anchor = document.createElement("button");
      document.body.append(anchor);
      openFavoriteMenu({ anchor, state, loadFolders: () => Promise.resolve(folders) });
      await flushMicrotasks(2);
      return document.querySelector<HTMLElement>(".fav-item.is-current");
    };

    const bySlot = await openWith(favoriteState({ folder: "Good Stuff", slot: 1 }));
    expect(bySlot?.textContent).toContain("Good Stuff");
    expect(bySlot?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll(".fav-item.is-current")).toHaveLength(1);
    expect(bySlot?.querySelector(".fav-check")?.textContent).toBe("✓");

    closeFavoriteMenu();
    const byName = await openWith(favoriteState({ folder: "plan to read", slot: null }));
    expect(byName?.textContent).toContain("Plan to Read");
  });

  test("does not mark a folder for an unfavorited gallery", async () => {
    document.cookie = "ipb_member_id=1";
    const anchor = document.createElement("button");
    document.body.append(anchor);

    openFavoriteMenu({
      anchor,
      state: favoriteState(null, true),
      loadFolders: () => Promise.resolve([{ slot: 1, name: "Good Stuff", color: "#c8c8c8" }]),
    });

    await flushMicrotasks(2);

    expect(document.querySelector(".fav-item.is-current")).toBeNull();
    expect(document.querySelector(".fav-check")).toBeNull();
  });

  test("announces folder states through the menu's own region", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);

    openFavoriteMenu({
      anchor,
      state: favoriteState(null, true),
    });

    const node = document.querySelector<HTMLElement>("[role='status']");
    expect(node?.textContent).toBe("Loading folders…");

    await flushMicrotasks(2);

    expect(document.querySelector("[role='status']")).toBe(node);
    expect(node?.textContent).toBe("Sign in to use favorites.");
  });

  test("a failed note read blocks the move instead of blanking the note", async () => {
    document.cookie = "ipb_member_id=1";
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const writes: unknown[] = [];

    openFavoriteMenu({
      anchor,
      state: favoriteState({ folder: "Good Stuff", slot: 1 }),
      loadFolders: () =>
        Promise.resolve([
          { slot: 1, name: "Good Stuff", color: "#c8c8c8" },
          { slot: 2, name: "Plan to Read", color: "#ff7b7b" },
        ]),
      loadNote: () => Promise.reject(new Error("rate limited")),
      save: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    await flushMicrotasks(2);
    const target = [...document.querySelectorAll<HTMLButtonElement>(".fav-item")].find((item) =>
      item.textContent.includes("Plan to Read"),
    );
    target?.click();
    await flushMicrotasks(4);

    // Posting an empty note here would erase the saved one, so nothing is posted at all.
    expect(writes).toEqual([]);
    expect(document.querySelector(".fav-link")?.textContent).toContain("native");
    expect(document.querySelector("[role='status']")?.textContent).toContain("note");
  });

  test("loads the saved note and submits it with the folder change", async () => {
    document.cookie = "ipb_member_id=1";
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const writes: { slot: number | null; note: string }[] = [];

    openFavoriteMenu({
      anchor,
      state: favoriteState({ folder: "Good Stuff", slot: 1 }),
      loadFolders: () =>
        Promise.resolve([
          { slot: 1, name: "Good Stuff", color: "#c8c8c8" },
          { slot: 2, name: "Plan to Read", color: "#ff7b7b" },
        ]),
      loadNote: () => Promise.resolve("keep me"),
      save: (_gallery, slot, note) => {
        writes.push({ slot, note: note ?? "" });
        return Promise.resolve();
      },
    });

    await flushMicrotasks(2);
    const note = document.querySelector<HTMLTextAreaElement>(".fav-note");
    expect(note?.value).toBe("keep me");

    const target = [...document.querySelectorAll<HTMLButtonElement>(".fav-item")].find((item) =>
      item.textContent.includes("Plan to Read"),
    );
    target?.click();
    await flushMicrotasks(2);

    expect(writes).toEqual([{ slot: 2, note: "keep me" }]);
  });
});
