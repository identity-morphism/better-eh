import { beforeEach, describe, expect, test } from "bun:test";

import { trackStickyChrome } from "../../src/ui/sticky";
import { installDom } from "./dom";
import { TestResizeObserver } from "./observers";

let frames: FrameRequestCallback[];

beforeEach(() => {
  installDom();
  frames = [];
  Object.assign(globalThis, {
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => undefined,
  });
});

function runFrames(): void {
  const pending = [...frames];
  frames = [];
  for (const callback of pending) {
    callback(0);
  }
}

function withHeight(node: HTMLElement, height: number): HTMLElement {
  Object.defineProperty(node, "getBoundingClientRect", {
    value: () => ({ height }) as DOMRect,
    configurable: true,
  });
  return node;
}

function pinnedStack(): {
  root: HTMLElement;
  topbar: HTMLElement;
  jump: HTMLElement;
  tabs: HTMLElement;
} {
  const root = document.createElement("main");
  const topbar = withHeight(document.createElement("div"), 40);
  topbar.className = "topbar";
  const jump = withHeight(document.createElement("div"), 30);
  jump.className = "settings-jump";
  const tabs = withHeight(document.createElement("div"), 20);
  tabs.className = "toplist-tabs";
  root.append(topbar, jump, tabs);
  document.body.append(root);
  return { root, topbar, jump, tabs };
}

describe("trackStickyChrome", () => {
  test("publishes the pinned stack height and updates on resize", () => {
    const { root, topbar } = pinnedStack();

    const stop = trackStickyChrome(root);
    runFrames();

    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("40px");
    expect(document.documentElement.style.getPropertyValue("--sticky-reading-line")).toBe("102px");

    withHeight(topbar, 60);
    window.dispatchEvent(new Event("resize"));
    runFrames();

    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("60px");
    expect(document.documentElement.style.getPropertyValue("--sticky-reading-line")).toBe("122px");

    stop();
    expect(TestResizeObserver.last?.disconnected).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sticky-reading-line")).toBe("");
  });

  test("measures the header once and ignores growth outside the pinned rows", () => {
    const { root, topbar, jump, tabs } = pinnedStack();
    const feed = document.createElement("div");
    root.append(feed);

    let headerReads = 0;
    Object.defineProperty(topbar, "getBoundingClientRect", {
      value: () => {
        headerReads += 1;
        return { height: 40 } as DOMRect;
      },
      configurable: true,
    });

    const stop = trackStickyChrome(root);
    runFrames();
    expect(headerReads).toBe(1);

    const observer = TestResizeObserver.last;
    if (observer === null) {
      throw new Error("expected a resize observer");
    }
    expect(observer.observed.has(root)).toBe(false);
    expect([...observer.observed]).toEqual([topbar, jump, tabs]);

    // A feed append grows a child the pinned chrome does not contain: no reapply, no remeasure.
    headerReads = 0;
    feed.append(document.createElement("div"));
    runFrames();
    expect(headerReads).toBe(0);
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("40px");

    // The pinned rows still drive updates when they do change.
    withHeight(jump, 50);
    observer.fire();
    runFrames();
    expect(headerReads).toBe(1);
    expect(document.documentElement.style.getPropertyValue("--sticky-reading-line")).toBe("122px");

    stop();
  });
});
