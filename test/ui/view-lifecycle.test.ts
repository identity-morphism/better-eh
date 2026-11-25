import { beforeEach, describe, expect, test } from "bun:test";

import type { Route } from "../../src/router";
import type { ViewLifecycle, ViewLifecycleDeps } from "../../src/view-lifecycle";
import { createViewLifecycle } from "../../src/view-lifecycle";
import { installDom } from "./dom";

const ROUTE: Route = { kind: "settings", url: "https://e-hentai.org/settings" };

interface Harness {
  lifecycle: ViewLifecycle;
  calls: string[];
  scrolls: number[];
  scheduled: (() => void)[];
  tracked: HTMLElement[];
}

function harness(
  host: () => HTMLElement | null,
  overrides: Partial<ViewLifecycleDeps> = {},
): Harness {
  const calls: string[] = [];
  const scrolls: number[] = [];
  const scheduled: (() => void)[] = [];
  const tracked: HTMLElement[] = [];
  const lifecycle = createViewLifecycle({
    host,
    closePanels: () => {
      calls.push("close");
    },
    resetViewMode: () => {
      calls.push("reset");
    },
    trackSticky: (root) => {
      tracked.push(root);
      return () => {
        calls.push("dispose");
      };
    },
    scrollTo: (y) => {
      scrolls.push(y);
    },
    scheduleScroll: (fn) => {
      scheduled.push(fn);
    },
    ...overrides,
  });
  return { lifecycle, calls, scrolls, scheduled, tracked };
}

let doc: Document;
let host: HTMLElement;

beforeEach(() => {
  doc = installDom();
  host = doc.createElement("main");
  host.append(doc.createElement("p"));
});

describe("view lifecycle", () => {
  test("clears the host, renders the view, titles the document and records the route", () => {
    const h = harness(() => host);
    const rendered: { host: HTMLElement; signal: AbortSignal }[] = [];

    const signal = h.lifecycle.mount({
      route: ROUTE,
      title: "Settings · e-hentai",
      render: (root, mountSignal) => {
        rendered.push({ host: root, signal: mountSignal });
        root.append(doc.createElement("section"));
      },
    });

    expect(signal).not.toBeNull();
    expect(host.querySelector("p")).toBeNull();
    expect(host.querySelector("section")).not.toBeNull();
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.host).toBe(host);
    expect(rendered[0]?.signal === signal).toBe(true);
    expect(doc.title).toBe("Settings · e-hentai");
    expect(h.tracked).toEqual([host]);
    expect(h.lifecycle.currentRoute()).toBe(ROUTE);
    expect(h.calls).toEqual(["close", "reset"]);
  });

  test("aborts the previous mount and disposes its sticky tracker", () => {
    const h = harness(() => host);

    const first = h.lifecycle.mount({ route: ROUTE, title: "First", render: () => undefined });
    expect(first?.aborted).toBe(false);

    h.lifecycle.mount({ route: ROUTE, title: "Second", render: () => undefined });

    expect(first?.aborted).toBe(true);
    expect(h.tracked).toHaveLength(2);
    expect(h.calls).toContain("dispose");
    expect(doc.title).toBe("Second");
  });

  test("uses the retrying restore for a saved position and stops it on the next mount", () => {
    const restored: number[] = [];
    const stopped: number[] = [];
    const h = harness(() => host, {
      restoreScroll: (y) => {
        restored.push(y);
        return () => {
          stopped.push(y);
        };
      },
    });

    h.lifecycle.mount({ route: ROUTE, title: "Restored", scrollY: 4000, render: () => undefined });

    expect(restored).toEqual([4000]);
    expect(h.scheduled).toHaveLength(0);

    h.lifecycle.mount({ route: ROUTE, title: "Next", render: () => undefined });
    expect(stopped).toEqual([4000]);
  });

  test("schedules the top, scrolls immediately for null and leaves the position alone when omitted", () => {
    const restored: number[] = [];
    const h = harness(() => host, {
      restoreScroll: (y) => {
        restored.push(y);
        return () => undefined;
      },
    });

    h.lifecycle.mount({ route: ROUTE, title: "Top", scrollY: 0, render: () => undefined });
    expect(restored).toEqual([]);
    expect(h.scheduled).toHaveLength(1);

    h.scheduled[0]?.();
    expect(h.scrolls).toEqual([0]);

    h.lifecycle.mount({ route: ROUTE, title: "Null", scrollY: null, render: () => undefined });
    expect(h.scrolls).toEqual([0, 0]);

    h.lifecycle.mount({ route: ROUTE, title: "Omitted", render: () => undefined });
    expect(h.scrolls).toEqual([0, 0]);
    expect(h.scheduled).toHaveLength(1);
  });

  test("moves focus to the host only on a user navigation", () => {
    const h = harness(() => host);
    let focused = 0;
    host.focus = () => {
      focused += 1;
    };

    h.lifecycle.mount({ route: ROUTE, title: "Cold", render: () => undefined });
    expect(focused).toBe(0);

    h.lifecycle.mount({ route: ROUTE, title: "Focused", focus: true, render: () => undefined });
    expect(focused).toBe(1);
  });

  test("runs the registered leave guard and clears it on the next mount", () => {
    const h = harness(() => host);
    expect(h.lifecycle.guard()).toBe(true);

    let runs = 0;
    h.lifecycle.setLeaveGuard(() => {
      runs += 1;
      return false;
    });
    expect(h.lifecycle.guard()).toBe(false);
    expect(runs).toBe(1);

    h.lifecycle.setLeaveGuard(() => true);
    expect(h.lifecycle.guard()).toBe(true);
    expect(runs).toBe(1);

    h.lifecycle.setLeaveGuard(() => false);
    h.lifecycle.setLeaveGuard(null);
    expect(h.lifecycle.guard()).toBe(true);

    h.lifecycle.setLeaveGuard(() => false);
    h.lifecycle.mount({ route: ROUTE, title: "Next", render: () => undefined });

    expect(h.lifecycle.guard()).toBe(true);
    expect(runs).toBe(1);
  });

  test("renders nothing and returns null when the host is gone", () => {
    const h = harness(() => null);
    const initialTitle = doc.title;
    let rendered = false;

    const signal = h.lifecycle.mount({
      route: ROUTE,
      title: "Nowhere",
      scrollY: 12,
      render: () => {
        rendered = true;
      },
    });

    expect(signal).toBeNull();
    expect(rendered).toBe(false);
    expect(h.calls).toEqual([]);
    expect(h.scrolls).toEqual([]);
    expect(h.scheduled).toEqual([]);
    expect(doc.title).toBe(initialTitle);
  });
});
