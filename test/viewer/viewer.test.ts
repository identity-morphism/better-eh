import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  Element,
  HTMLElement as LinkedomElement,
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
} from "linkedom";

import { getResume } from "../../src/data/resume";
import { DEFAULT_SETTINGS, getSettings, updateSetting, updateSettings } from "../../src/settings";
import type { PageData } from "../../src/types";
import type { ViewContext } from "../../src/views/context";
import { flushMicrotasks } from "../ui/async";
import { installDom, mountHost, requireNode, viewContext } from "../ui/dom";
import { installTestObservers } from "../ui/observers";

const GALLERY = "https://e-hentai.org/g/123456/abcdef1234/";
const VIEWER = "https://e-hentai.org/s/hash/123456-2";
const NEXT = "https://e-hentai.org/s/hash/123456-3";
const NEXT_NEXT = "https://e-hentai.org/s/hash/123456-4";

interface ViewerCall {
  url: string;
  options: unknown;
}

const state = {
  pages: new Map<string, PageData>(),
  viewerCalls: [] as ViewerCall[],
  retry: null as PageData | null,
  retryCalls: [] as PageData[],
  prefetched: [] as PageData[],
  prefetchCancels: 0,
  toasts: [] as string[],
};

void mock.module("../../src/fetch/loader", () => ({
  loader: {
    viewerPage: (url: string, options?: unknown) => {
      state.viewerCalls.push({ url, options });
      const found = state.pages.get(url);
      return found ? Promise.resolve(found) : Promise.reject(new Error(`no page for ${url}`));
    },
    retryWithNl: (data: PageData) => {
      state.retryCalls.push(data);
      return Promise.resolve(state.retry);
    },
  },
}));

void mock.module("../../src/fetch/prefetch", () => ({
  createPrefetcher: () => ({
    warm: (data: PageData) => {
      state.prefetched.push(data);
    },
    cancel: () => {
      state.prefetchCancels += 1;
    },
  }),
}));

void mock.module("../../src/ui/toast", () => ({
  showToast: (text: string) => {
    state.toasts.push(text);
  },
}));

// The loader, prefetcher and toast mocks must be registered before viewer.ts is evaluated, so this
// import cannot be static.
const { mountViewer } = await import("../../src/views/viewer");

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Stand-in for the detached `new Image()` probe the original upgrade loads. */
class TestProbeImage {
  static instances: TestProbeImage[] = [];

  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly complete = false;
  readonly naturalWidth = 1600;
  readonly naturalHeight = 2400;
  readonly clientHeight = 0;
  src = "";

  constructor() {
    TestProbeImage.instances.push(this);
  }
}

function page(overrides: Partial<PageData> = {}): PageData {
  return {
    viewerUrl: VIEWER,
    pageNum: 2,
    counterText: "2 / 5",
    galleryTitle: {
      leading: [{ text: "[Circle]", type: "artist" }],
      primary: "A Viewer Title",
      secondary: "Subtitle",
      trailing: [{ text: "[English]", type: "lang" }],
    },
    imgSrc: "https://img.example/pages/2.jpg",
    originalHref: "https://img.example/original/2.png",
    nextHref: NEXT,
    prevHref: "https://e-hentai.org/s/hash/123456-1",
    firstHref: "https://e-hentai.org/s/hash/123456-1",
    lastHref: "https://e-hentai.org/s/hash/123456-5",
    fileInfo: "1,234 KB :: 800 x 1200",
    galleryHref: GALLERY,
    nlToken: "777",
    forumHref: "https://forums.e-hentai.org/index.php?showtopic=123",
    searchHref: "https://e-hentai.org/?f_shash=abc123",
    ...overrides,
  };
}

interface Harness {
  ctx: ViewContext;
  controller: AbortController;
  navigations: Array<{ url: string; options?: unknown }>;
}

function harness(): Harness {
  const controller = new AbortController();
  const navigations: Array<{ url: string; options?: unknown }> = [];
  return {
    controller,
    navigations,
    ctx: viewContext({
      signal: controller.signal,
      navigate: (url, options) => {
        navigations.push({ url, options });
      },
    }),
  };
}

function click(node: Element): void {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  });
  node.dispatchEvent(event);
}

function clickAt(node: Element, clientX: number): void {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0,
    clientX,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  });
  node.dispatchEvent(event);
}

function press(key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  document.dispatchEvent(event);
}

function ctrlPress(key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(event, { key, ctrlKey: true, metaKey: false });
  document.dispatchEvent(event);
}

let document: Document;
let host: HTMLElement;
let active: Harness | null;
let historyBacks: number;

beforeEach(() => {
  document = installDom();
  host = mountHost(document);
  active = null;
  historyBacks = 0;
  state.pages.clear();
  state.viewerCalls.length = 0;
  state.retry = null;
  state.retryCalls.length = 0;
  state.prefetched.length = 0;
  state.prefetchCancels = 0;
  state.toasts.length = 0;
  TestProbeImage.instances.length = 0;

  installTestObservers();
  Object.assign(globalThis, {
    Element,
    HTMLElement: LinkedomElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement,
    Image: TestProbeImage,
    ResizeObserver: TestResizeObserver,
    history: {
      state: {},
      back: () => {
        historyBacks += 1;
      },
    },
  });
  Object.assign(window, {
    scrollTo: () => undefined,
    scrollBy: () => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
  });
  Object.defineProperties(window, {
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
    devicePixelRatio: { value: 1, configurable: true },
    scrollY: { value: 0, configurable: true },
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  (LinkedomElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () =>
    undefined;

  updateSettings(DEFAULT_SETTINGS);
  GM_setValue("eh:resume:v1", {});
});

afterEach(() => {
  active?.controller.abort();
});

describe("mountViewer", () => {
  test("mounts the shell with the page's identity and links", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    expect(host.querySelector("#reader")).not.toBeNull();
    expect(host.querySelector("#hud-title")?.textContent).toContain("A Viewer Title");
    expect(host.querySelector("#hud-title")?.textContent).toContain("Subtitle");
    expect(host.querySelector("#hud-counter")?.textContent).toBe("2 / 5");
    expect(host.querySelector("#file-info")?.textContent).toBe("1,234 KB :: 800 x 1200");

    const gallery = requireNode<HTMLAnchorElement>(host, "#hud-gallery");
    expect(gallery.getAttribute("href")).toBe(GALLERY);

    const img = requireNode<HTMLImageElement>(host, "#main-img");
    expect(img.getAttribute("src")).toBe(data.imgSrc);
    expect(img.getAttribute("alt")).toBe("A Viewer Title — page 2 / 5");

    expect(requireNode<HTMLAnchorElement>(host, "#hud-original").hidden).toBe(false);
    expect(requireNode<HTMLAnchorElement>(host, "#hud-original").getAttribute("href")).toBe(
      data.originalHref,
    );
    expect(requireNode<HTMLAnchorElement>(host, "#hud-forum").hidden).toBe(false);
    expect(requireNode<HTMLAnchorElement>(host, "#hud-search").hidden).toBe(false);

    for (const id of ["#hud-first", "#hud-prev", "#hud-next", "#hud-last"]) {
      expect(requireNode<HTMLButtonElement>(host, id).disabled).toBe(false);
    }

    expect(document.body.classList.contains("eh-viewer")).toBe(true);
    expect(document.body.classList.contains("fit-h")).toBe(true);
    expect(state.prefetched).toEqual([data]);
  });

  test("navigation buttons use the parsed links and toast at the edges", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    click(requireNode(host, "#hud-next"));
    click(requireNode(host, "#hud-prev"));
    click(requireNode(host, "#hud-first"));
    click(requireNode(host, "#hud-last"));

    expect(active.navigations).toEqual([
      { url: NEXT, options: { replace: true } },
      { url: data.prevHref ?? "", options: { replace: true } },
      { url: data.firstHref ?? "", options: { replace: true } },
      { url: data.lastHref ?? "", options: { replace: true } },
    ]);

    active.controller.abort();
    active = harness();
    host.replaceChildren();
    const edge = page({ nextHref: null, prevHref: null, firstHref: null, lastHref: null });
    mountViewer(host, edge, active.ctx);
    state.toasts.length = 0;

    click(requireNode(host, "#hud-next"));
    click(requireNode(host, "#hud-prev"));
    click(requireNode(host, "#hud-first"));
    click(requireNode(host, "#hud-last"));

    expect(state.toasts).toEqual(["Last page", "First page", "First page", "Last page"]);
    expect(active.navigations).toEqual([]);
  });

  test("keyboard shortcuts drive help, fit, navigation and image reload", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    const help = requireNode<HTMLElement>(host, "#hud-help");
    expect(help.hidden).toBe(true);
    press("?");
    expect(help.hidden).toBe(false);
    press("?");
    expect(help.hidden).toBe(true);

    press("f");
    expect(getSettings().fitHeight).toBe(false);
    expect(document.body.classList.contains("fit-w")).toBe(true);

    press("ArrowRight");
    press("ArrowLeft");
    expect(active.navigations).toEqual([
      { url: NEXT, options: { replace: true } },
      { url: data.prevHref ?? "", options: { replace: true } },
    ]);

    const img = requireNode<HTMLImageElement>(host, "#main-img");
    press("r");
    expect(img.getAttribute("src")).toContain("nl=777");
    expect(state.toasts).toContain("Reloading image");

    press("?");
    press("Escape");
    expect(help.hidden).toBe(true);
    expect(active.navigations).toHaveLength(2);

    press("Escape");
    expect(active.navigations.at(-1)?.url).toBe(GALLERY);
  });

  test("click zones navigate and the middle pins the chrome", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    const reader = requireNode(host, "#reader");
    clickAt(reader, 900);
    expect(active.navigations.at(-1)?.url).toBe(NEXT);

    clickAt(reader, 100);
    expect(active.navigations.at(-1)?.url).toBe(data.prevHref ?? "");

    clickAt(reader, 500);
    expect(document.body.classList.contains("hud-pinned")).toBe(true);
    clickAt(reader, 500);
    expect(document.body.classList.contains("hud-pinned")).toBe(false);
  });

  test("spread mode loads the facing page and skips it when navigating", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "spread" });
    const companion = page({
      viewerUrl: NEXT,
      pageNum: 3,
      counterText: "3 / 5",
      imgSrc: "https://img.example/pages/3.jpg",
      prevHref: VIEWER,
      nextHref: NEXT_NEXT,
    });
    state.pages.set(NEXT, companion);

    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);
    await flushMicrotasks(12);

    const spread = requireNode<HTMLImageElement>(host, "#spread-img");
    expect(spread.hidden).toBe(false);
    expect(spread.getAttribute("src")).toBe(companion.imgSrc);
    expect(requireNode(host, "#img-wrap").classList.contains("is-single")).toBe(false);

    click(requireNode(host, "#hud-next"));
    expect(active.navigations).toEqual([{ url: NEXT_NEXT, options: { replace: true } }]);
  });

  test("spread Previous from page 2 lands on page 1", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "spread" });
    const FIRST = "https://e-hentai.org/s/hash/123456-1";
    const first = page({
      viewerUrl: FIRST,
      pageNum: 1,
      counterText: "1 / 5",
      imgSrc: "https://img.example/pages/1.jpg",
      prevHref: null,
    });
    state.pages.set(FIRST, first);
    state.pages.set(
      NEXT,
      page({ viewerUrl: NEXT, pageNum: 3, counterText: "3 / 5", prevHref: VIEWER }),
    );

    active = harness();
    mountViewer(host, page(), active.ctx);
    await flushMicrotasks(12);

    click(requireNode(host, "#hud-prev"));
    await flushMicrotasks(12);

    expect(state.toasts).toEqual([]);
    expect(active.navigations).toEqual([{ url: FIRST, options: { replace: true } }]);
  });

  test("a control inside the continuous stack keeps its own click", () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "continuous" });
    active = harness();
    mountViewer(host, page(), active.ctx);

    const continuous = requireNode<HTMLElement>(host, "#continuous");
    const button = document.createElement("button");
    button.type = "button";
    continuous.append(button);
    // Centre of the viewport: without the exclusion this click toggles the HUD.
    clickAt(button, 500);

    expect(active.navigations).toEqual([]);
    expect(state.toasts).toEqual([]);
    expect(document.body.classList.contains("hud-pinned")).toBe(false);
  });

  test("a failed facing page falls back to a single slot", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "spread" });
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);
    await flushMicrotasks(12);

    expect(requireNode<HTMLImageElement>(host, "#spread-img").hidden).toBe(true);
    expect(requireNode(host, "#img-wrap").classList.contains("is-single")).toBe(true);
  });

  test("a horizontal touch swipe navigates", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);
    const reader = requireNode(host, "#reader");

    const swipe = (from: number, to: number): void => {
      const down = new Event("pointerdown", { bubbles: true, cancelable: true });
      Object.assign(down, { pointerType: "touch", pointerId: 1, clientX: from, clientY: 400 });
      reader.dispatchEvent(down);

      const up = new Event("pointerup", { bubbles: true, cancelable: true });
      Object.assign(up, { pointerType: "touch", pointerId: 1, clientX: to, clientY: 400 });
      reader.dispatchEvent(up);
    };

    swipe(500, 400);
    expect(active.navigations.at(-1)?.url).toBe(NEXT);

    swipe(400, 500);
    expect(active.navigations.at(-1)?.url).toBe(data.prevHref ?? "");
  });

  test("continuous mode appends the next page and advances the counter", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "continuous" });
    const next = page({
      viewerUrl: NEXT,
      pageNum: 3,
      counterText: "3 / 5",
      imgSrc: "https://img.example/pages/3.jpg",
      prevHref: VIEWER,
      nextHref: null,
    });
    state.pages.set(NEXT, next);

    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    const continuous = requireNode<HTMLElement>(host, "#continuous");
    expect(continuous.hidden).toBe(false);
    expect(requireNode<HTMLElement>(host, "#img-wrap").hidden).toBe(true);
    expect(continuous.querySelectorAll(".reader-page")).toHaveLength(1);
    expect(requireNode(host, "#main-img").hasAttribute("src")).toBe(false);
    expect(state.viewerCalls).toEqual([]);

    click(requireNode(host, "#hud-next"));
    await flushMicrotasks(12);

    expect(continuous.querySelectorAll(".reader-page")).toHaveLength(2);
    expect(host.querySelector("#hud-counter")?.textContent).toBe("3 / 5");
    expect(state.viewerCalls.some((call) => call.url === NEXT)).toBe(true);
  });

  test("an image failure shows the error panel and retries through the loader", async () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    const img = requireNode<HTMLImageElement>(host, "#main-img");
    expect(typeof img.onerror).toBe("function");
    img.onerror?.(new Event("error"));
    await flushMicrotasks(12);

    const error = requireNode<HTMLElement>(host, "#img-error");
    expect(error.hidden).toBe(false);
    expect(host.querySelector("#img-error-text")?.textContent).toContain("2 / 5");
    expect(state.retryCalls).toHaveLength(1);

    // Retry cannot help without an `nl` token, so the panel always carries the native way out.
    const native = requireNode<HTMLAnchorElement>(host, "#img-error-native");
    expect(native.textContent).toBe("Open native page");
    expect(native.getAttribute("href")).toContain("eh_native=1");

    const fixed = page({ imgSrc: "https://img.example/pages/fixed.jpg" });
    state.retry = fixed;
    click(requireNode(host, "#img-error-retry"));
    await flushMicrotasks(12);

    expect(requireNode<HTMLImageElement>(host, "#main-img").getAttribute("src")).toBe(fixed.imgSrc);
    expect(error.hidden).toBe(true);
  });

  test("aborting the view flushes the reading position and tears down the shell", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    active.controller.abort();

    expect(getResume(GALLERY)?.pageNum).toBe(2);
    expect(requireNode(host, "#main-img").hasAttribute("src")).toBe(false);
    expect(requireNode(host, "#spread-img").hasAttribute("src")).toBe(false);
    expect(state.prefetchCancels).toBe(1);
    expect(document.body.classList.contains("hud-pinned")).toBe(false);
  });

  test("the gallery link uses history when the reader came from the gallery", () => {
    const data = page();
    active = harness();
    (history.state as Record<string, unknown>).fromGallery = true;
    mountViewer(host, data, active.ctx);

    click(requireNode(host, "#hud-gallery"));

    expect(historyBacks).toBe(1);
    expect(active.navigations).toEqual([]);
  });

  test("settings changes repaint fit and reader layout classes", () => {
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    updateSetting("fitHeight", false);
    expect(document.body.classList.contains("fit-w")).toBe(true);
    expect(document.body.classList.contains("fit-h")).toBe(false);

    updateSetting("readerMode", "spread");
    expect(document.body.classList.contains("reader-spread")).toBe(true);
    expect(requireNode<HTMLElement>(host, "#img-wrap").hidden).toBe(false);
  });

  const deepZoomCases = [
    { mode: "continuous", name: "continuous deep zoom upgrades the visible page's original" },
    { mode: "spread", name: "spread deep zoom upgrades both visible pages" },
  ] as const;

  for (const { mode, name } of deepZoomCases) {
    test(name, async () => {
      updateSettings({ ...DEFAULT_SETTINGS, readerMode: mode });
      const data = page();
      const companion =
        mode === "spread"
          ? page({
              viewerUrl: NEXT,
              pageNum: 3,
              counterText: "3 / 5",
              imgSrc: "https://img.example/pages/3.jpg",
              originalHref: "https://img.example/original/3.png",
              prevHref: VIEWER,
              nextHref: NEXT_NEXT,
            })
          : null;
      if (companion) {
        state.pages.set(NEXT, companion);
      }

      active = harness();
      mountViewer(host, data, active.ctx);
      await flushMicrotasks(12);

      const images =
        mode === "continuous"
          ? [requireNode<HTMLImageElement>(host, "#continuous .reader-page-img")]
          : [
              requireNode<HTMLImageElement>(host, "#main-img"),
              requireNode<HTMLImageElement>(host, "#spread-img"),
            ];
      for (const img of images) {
        Object.defineProperty(img, "clientHeight", { value: 400, configurable: true });
        Object.defineProperty(img, "naturalHeight", { value: 1200, configurable: true });
        Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      }

      for (let step = 0; step < 21; step++) {
        ctrlPress("=");
      }

      expect(TestProbeImage.instances).toHaveLength(images.length);
      for (const probe of TestProbeImage.instances) {
        probe.onload?.(new Event("load"));
      }

      const originals = companion
        ? [data.originalHref, companion.originalHref]
        : [data.originalHref];
      if (originals.some((src) => src === null)) {
        throw new Error("missing original href");
      }
      expect(images.map((img) => img.getAttribute("src"))).toEqual(originals);
    });
  }

  test("continuous R reloads the visible page's native token", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "continuous" });
    const next = page({
      viewerUrl: NEXT,
      pageNum: 3,
      counterText: "3 / 5",
      imgSrc: "https://img.example/pages/3.jpg",
      nlToken: "888",
      prevHref: VIEWER,
      nextHref: null,
    });
    state.pages.set(NEXT, next);

    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    click(requireNode(host, "#hud-next"));
    await flushMicrotasks(12);

    const images = [...host.querySelectorAll<HTMLImageElement>("#continuous .reader-page-img")];
    expect(images).toHaveLength(2);

    press("r");

    expect(images[1]?.getAttribute("src")).toContain("nl=888");
    expect(images[0]?.getAttribute("src")).not.toContain("nl=777");
  });

  test("a failed continuous page offers retry and leaves Next enabled", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "continuous" });
    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);

    click(requireNode(host, "#hud-next"));
    await flushMicrotasks(12);

    const retry = requireNode<HTMLButtonElement>(
      host,
      "#continuous .continuous-status .infinite-retry",
    );
    expect(retry.hidden).toBe(false);
    expect(requireNode<HTMLButtonElement>(host, "#hud-next").disabled).toBe(false);
    expect(state.toasts).not.toContain("Last page");
    expect(host.querySelectorAll("#continuous .reader-page")).toHaveLength(1);

    state.pages.set(
      NEXT,
      page({
        viewerUrl: NEXT,
        pageNum: 3,
        counterText: "3 / 5",
        imgSrc: "https://img.example/pages/3.jpg",
        prevHref: VIEWER,
        nextHref: null,
      }),
    );
    retry.click();
    await flushMicrotasks(12);

    expect(host.querySelectorAll("#continuous .reader-page")).toHaveLength(2);
    expect(retry.hidden).toBe(true);
  });

  test("spread Next at the trailing edge does not re-open the displayed page", async () => {
    updateSettings({ ...DEFAULT_SETTINGS, readerMode: "spread" });
    const companion = page({
      viewerUrl: NEXT,
      pageNum: 3,
      counterText: "3 / 5",
      imgSrc: "https://img.example/pages/3.jpg",
      prevHref: VIEWER,
      nextHref: null,
    });
    state.pages.set(NEXT, companion);

    const data = page();
    active = harness();
    mountViewer(host, data, active.ctx);
    await flushMicrotasks(12);

    const nextButton = requireNode<HTMLButtonElement>(host, "#hud-next");
    expect(nextButton.disabled).toBe(true);

    click(nextButton);
    press("ArrowRight");
    clickAt(requireNode(host, "#reader"), 900);
    await flushMicrotasks(12);

    expect(active.navigations).toEqual([]);
    expect(state.toasts).toEqual(["Last page", "Last page", "Last page"]);
  });
});
