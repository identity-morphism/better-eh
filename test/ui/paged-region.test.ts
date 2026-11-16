import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { updateSetting } from "../../src/settings";
import { el } from "../../src/ui/dom";
import type { CursorPage } from "../../src/ui/page-cursor";
import { createPagedRegion } from "../../src/ui/paged-region";
import { installDom, mountHost } from "./dom";
import { installTestObservers, lastObserver, settle, TestObserver } from "./observers";

let slot: HTMLElement;
let sentinelHost: HTMLElement;
let controllers: AbortController[];

beforeEach(() => {
  const document = installDom();
  installTestObservers();
  controllers = [];
  updateSetting("galleryInfiniteScroll", false);
  slot = mountHost(document);
  sentinelHost = mountHost(document);
});

afterEach(() => {
  for (const controller of controllers) {
    controller.abort();
  }
});

interface Harness {
  /** Each pager build records whether it was asked for a next link. */
  modes: boolean[];
  appended: string[];
  undone: string[];
  calls: string[];
}

function region(
  pages: Record<string, CursorPage<string>>,
  initial: readonly string[] = ["a"],
  next: string | null = "/p2",
  signal?: AbortSignal,
): Harness {
  const owned = new AbortController();
  if (signal === undefined) {
    controllers.push(owned);
  }
  const harness: Harness = {
    modes: [],
    appended: [],
    undone: [],
    calls: [],
  };
  createPagedRegion<string>({
    signal: signal ?? owned.signal,
    next,
    initial,
    key: (value) => value,
    noun: "items",
    enabled: (settings) => settings.galleryInfiniteScroll,
    slot,
    pager: (withNext) => {
      harness.modes.push(withNext);
      return el("nav", { class: "pager" });
    },
    load: (url) => {
      harness.calls.push(url);
      return Promise.resolve(pages[url] ?? { items: [], next: null });
    },
    append: (items) => {
      harness.appended.push(...items);
      const batch = items.join(",");
      return () => harness.undone.push(batch);
    },
    placeSentinel: (node) => sentinelHost.append(node),
  });
  return harness;
}

function sentinel(): HTMLElement {
  const node = sentinelHost.querySelector<HTMLElement>(".infinite-scroll");
  if (node === null) {
    throw new Error("no sentinel was placed");
  }
  return node;
}

describe("createPagedRegion", () => {
  test("draws the pager when infinite scroll is off", () => {
    const harness = region({});

    expect(harness.modes).toEqual([true]);
    expect(slot.querySelectorAll(".pager")).toHaveLength(1);
    expect(sentinelHost.childElementCount).toBe(0);
    expect(TestObserver.instances).toHaveLength(0);
  });

  test("enable swaps the pager for the placed sentinel", () => {
    const harness = region({});
    updateSetting("galleryInfiniteScroll", true);

    expect(harness.modes).toEqual([true, false]);
    expect(slot.querySelectorAll(".pager")).toHaveLength(1);
    expect(slot.querySelector(".infinite-scroll")).toBeNull();
    expect(sentinel()).not.toBeNull();
    expect(sentinel().hidden).toBe(false);
  });

  test("enabling with a null pager leaves the slot empty and places the sentinel", () => {
    const abort = new AbortController();
    controllers.push(abort);
    const placed: HTMLElement[] = [];
    createPagedRegion<string>({
      signal: abort.signal,
      next: "/p2",
      initial: ["a"],
      key: (value) => value,
      noun: "items",
      enabled: (settings) => settings.galleryInfiniteScroll,
      slot,
      pager: () => null,
      load: () => Promise.resolve({ items: [], next: null }),
      append: () => () => undefined,
      placeSentinel: (node) => {
        placed.push(node);
        sentinelHost.append(node);
      },
    });

    expect(slot.childElementCount).toBe(0);
    updateSetting("galleryInfiniteScroll", true);

    expect(slot.childElementCount).toBe(0);
    expect(placed).toHaveLength(1);
    expect(sentinelHost.querySelector(".infinite-scroll")).not.toBeNull();
  });

  test("renders appended pages and skips duplicate keys", async () => {
    updateSetting("galleryInfiniteScroll", true);
    const harness = region({
      "/p2": { items: ["a", "b"], next: "/p3" },
      "/p3": { items: ["b", "c"], next: null },
    });

    lastObserver().trigger(sentinel());
    await settle();
    expect(harness.calls).toEqual(["/p2"]);
    expect(harness.appended).toEqual(["b"]);

    lastObserver().trigger(sentinel());
    await settle();
    expect(harness.calls).toEqual(["/p2", "/p3"]);
    expect(harness.appended).toEqual(["b", "c"]);
  });

  test("disable runs undo callbacks in reverse and redraws the pager", async () => {
    updateSetting("galleryInfiniteScroll", true);
    const harness = region({
      "/p2": { items: ["b"], next: "/p3" },
      "/p3": { items: ["c"], next: null },
    });

    lastObserver().trigger(sentinel());
    await settle();
    lastObserver().trigger(sentinel());
    await settle();
    expect(harness.appended).toEqual(["b", "c"]);

    updateSetting("galleryInfiniteScroll", false);
    expect(harness.undone).toEqual(["c", "b"]);
    expect(harness.modes).toEqual([false, true]);
    expect(slot.querySelectorAll(".pager")).toHaveLength(1);
    expect(sentinelHost.childElementCount).toBe(0);
  });

  test("setting flips both ways without duplicating pagers or sentinels", () => {
    const harness = region({});
    updateSetting("galleryInfiniteScroll", true);
    updateSetting("galleryInfiniteScroll", false);
    updateSetting("galleryInfiniteScroll", true);

    expect(harness.modes).toEqual([true, false, true, false]);
    expect(slot.querySelectorAll(".pager")).toHaveLength(1);
    expect(sentinelHost.querySelectorAll(".infinite-scroll")).toHaveLength(1);

    // Unrelated settings must not rebuild the region.
    const modes = harness.modes.length;
    updateSetting("gap", 12);
    expect(harness.modes).toHaveLength(modes);
  });

  test("abort removes the sentinel and unsubscribes from settings", () => {
    updateSetting("galleryInfiniteScroll", true);
    const abort = new AbortController();
    const harness = region({}, ["a"], "/p2", abort.signal);
    const observer = lastObserver();

    abort.abort();
    expect(sentinelHost.childElementCount).toBe(0);
    expect(observer.targets.size).toBe(0);

    const modes = harness.modes.length;
    updateSetting("galleryInfiniteScroll", false);
    expect(harness.modes).toHaveLength(modes);
  });
});
