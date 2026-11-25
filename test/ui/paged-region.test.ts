import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { updateSetting } from "../../src/settings";
import { el } from "../../src/ui/dom";
import type { CursorPage } from "../../src/ui/page-cursor";
import { createPagedRegion } from "../../src/ui/paged-region";
import { installDom, mountHost } from "./dom";
import { installTestObservers, lastObserver, settle } from "./observers";

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
  const harness: Harness = { modes: [], appended: [], undone: [] };
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
    load: (url) => Promise.resolve(pages[url] ?? { items: [], next: null }),
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
  test("leaving infinite scroll undoes appends in reverse and redraws the pager", async () => {
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

  test("flipping the setting leaves one pager and one sentinel", () => {
    const harness = region({});
    updateSetting("galleryInfiniteScroll", true);
    updateSetting("galleryInfiniteScroll", false);
    updateSetting("galleryInfiniteScroll", true);

    expect(harness.modes).toEqual([true, false, true, false]);
    expect(slot.querySelectorAll(".pager")).toHaveLength(1);
    expect(sentinelHost.querySelectorAll(".infinite-scroll")).toHaveLength(1);
  });

  test("abort removes the sentinel and stops listening for setting changes", () => {
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
