import { beforeEach, describe, expect, test } from "bun:test";

import { trackStickyChrome } from "../../src/ui/sticky";
import { installDom } from "./dom";

class TestResizeObserver {
  static last: TestResizeObserver | null = null;

  disconnected = false;

  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.last = this;
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }
}

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

describe("trackStickyChrome", () => {
  test("publishes the pinned stack height and updates on resize", () => {
    const root = document.createElement("main");
    const topbar = withHeight(document.createElement("div"), 40);
    topbar.className = "topbar";
    const jump = withHeight(document.createElement("div"), 30);
    jump.className = "settings-jump";
    const tabs = withHeight(document.createElement("div"), 20);
    tabs.className = "toplist-tabs";
    root.append(topbar, jump, tabs);
    document.body.append(root);

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
});
