import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { ReaderHudState, ReaderNavigation } from "../../src/reader-navigation";
import { DEFAULT_SETTINGS, updateSettings } from "../../src/settings";
import type { PageData } from "../../src/types";
import { flushMicrotasks } from "../ui/async";
import { installDom } from "../ui/dom";
import { installTestObservers } from "../ui/observers";

const ORIGIN = "https://e-hentai.org/s/hash/123456-";
/** Reserved heights for the six varied-aspect pages below at a 1000px viewport width. */
const PAGE_HEIGHTS = [1500, 500, 750, 1200, 1000, 800];
const PAGE_ASPECTS = [
  "1,000 KB :: 800 x 1200",
  "1,000 KB :: 1600 x 800",
  "1,000 KB :: 1333 x 1000",
  "1,000 KB :: 1000 x 1200",
  "1,000 KB :: 1000 x 1000",
  "1,000 KB :: 1250 x 1000",
];
const pages = new Map<string, PageData>();

void mock.module("../../src/fetch/loader", () => ({
  loader: {
    viewerPage: (url: string) => {
      const found = pages.get(url);
      return found ? Promise.resolve(found) : Promise.reject(new Error(`no page for ${url}`));
    },
    retryWithNl: () => Promise.resolve(null),
  },
}));

// The loader mock must be registered before reader-navigation evaluates its static import, so
// this boundary import cannot be static even though the specifier is known here.
const { createReaderNavigation } = await import("../../src/reader-navigation");

function page(num: number, overrides: Partial<PageData> = {}): PageData {
  return {
    viewerUrl: `${ORIGIN}${num}`,
    pageNum: num,
    counterText: `${num} / 6`,
    galleryTitle: { leading: [], primary: "Reader test", secondary: null, trailing: [] },
    imgSrc: `https://img.example/pages/${num}.jpg`,
    originalHref: null,
    nextHref: num < 6 ? `${ORIGIN}${num + 1}` : null,
    prevHref: num > 1 ? `${ORIGIN}${num - 1}` : null,
    firstHref: num > 1 ? `${ORIGIN}1` : null,
    lastHref: num < 6 ? `${ORIGIN}6` : null,
    fileInfo: "1,000 KB :: 800 x 1200",
    galleryHref: "https://e-hentai.org/g/123456/abcdef1234/",
    nlToken: null,
    forumHref: null,
    searchHref: null,
    ...overrides,
  };
}

let document: Document;
let navigation: ReaderNavigation;
let controller: AbortController | null = null;
let container: HTMLElement;
let hud: ReaderHudState[];
let surfaceChanges: number;

function mountNavigation(): void {
  controller = new AbortController();
  container = document.createElement("div");
  document.body.append(container);
  const main = document.createElement("img");
  const spread = document.createElement("img");
  const wrap = document.createElement("span");
  navigation = createReaderNavigation({
    signal: controller.signal,
    navigate: () => undefined,
    toast: () => undefined,
    mainImage: main,
    spreadImage: spread,
    spreadWrap: wrap,
    continuousContainer: container,
    onHud: (state) => {
      hud.push(state);
    },
    onSurfaceChange: () => {
      surfaceChanges += 1;
    },
    onImageLoaded: () => undefined,
    onImageError: () => undefined,
    zoomLevel: () => 1,
  });
}

function setScroll(value: number): void {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
}

/** Run one reader scroll frame; the stubbed rAF delivers the callback as a microtask. */
async function scrollFrame(value: number): Promise<void> {
  setScroll(value);
  navigation.handleScroll();
  await flushMicrotasks(2);
}

async function appendUntil(count: number): Promise<void> {
  for (let loaded = 1; loaded < count; loaded += 1) {
    navigation.go("next");
    await flushMicrotasks(16);
  }
}

/** Pages with the different lazy-image aspects the reservation and geometry must handle. */
function setVariedAspects(): void {
  for (let num = 1; num <= 6; num += 1) {
    const fileInfo = PAGE_ASPECTS[num - 1];
    pages.set(`${ORIGIN}${num}`, page(num, fileInfo === undefined ? {} : { fileInfo }));
  }
}

interface RectReads {
  count: () => number;
  reset: () => void;
}

/** Report every page at its reserved height in document space, offset by the current scroll. */
function definePageRects(heights: readonly number[] = PAGE_HEIGHTS): RectReads {
  let reads = 0;
  let top = 0;
  const tops = heights.map((height) => {
    const value = top;
    top += height;
    return value;
  });
  const nodes = [...container.querySelectorAll<HTMLElement>(".reader-page")];
  nodes.forEach((node, position) => {
    const height = heights[position] ?? 0;
    const documentTop = tops[position] ?? 0;
    Object.defineProperty(node, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        reads += 1;
        const rectTop = documentTop - window.scrollY;
        // linkedom has no DOMRect constructor; the reader only reads top/height.
        const rect = {
          top: rectTop,
          bottom: rectTop + height,
          height,
          left: 0,
          right: 1000,
          width: 1000,
          x: 0,
          y: rectTop,
          toJSON: () => ({}),
        };
        return rect;
      },
    });
  });
  return {
    count: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

beforeEach(() => {
  document = installDom();
  installTestObservers();
  Object.assign(window, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      void Promise.resolve().then(() => callback(0));
      return 1;
    },
    cancelAnimationFrame: () => undefined,
    scrollTo: () => undefined,
    scrollBy: () => undefined,
  });
  Object.defineProperties(window, {
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
    scrollY: { value: 0, configurable: true },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });

  updateSettings({ ...DEFAULT_SETTINGS, readerMode: "continuous" });
  pages.clear();
  for (let num = 1; num <= 6; num += 1) {
    pages.set(`${ORIGIN}${num}`, page(num));
  }
  hud = [];
  surfaceChanges = 0;
});

afterEach(() => {
  controller?.abort();
  controller = null;
});

describe("continuous reader sync", () => {
  test("reports gallery edge flags from the mounted page", () => {
    setVariedAspects();
    mountNavigation();
    const second = pages.get(`${ORIGIN}2`);
    if (second === undefined) {
      throw new Error("missing second page");
    }

    navigation.show(second);

    expect(hud).toHaveLength(1);
    expect(hud[0]?.first).toBe(true);
    expect(hud[0]?.prev).toBe(false);
    expect(hud[0]?.next).toBe(true);
    expect(hud[0]?.last).toBe(true);
  });

  test("indexes a long stack without rereading every page each frame", async () => {
    setVariedAspects();
    mountNavigation();
    const first = pages.get(`${ORIGIN}1`);
    if (first === undefined) {
      throw new Error("missing first page");
    }
    navigation.show(first);
    await appendUntil(6);

    const reads = definePageRects();
    hud.length = 0;
    surfaceChanges = 0;

    // The stack starts at the bottom. The nearby scan cannot see the top, so this frame pays for
    // one full measure: four nearby rects plus six cached tops.
    await scrollFrame(0);
    expect(reads.count()).toBe(10);
    expect(hud).toHaveLength(1);
    expect(navigation.currentPage().pageNum).toBe(1);
    expect(hud[0]?.prev).toBe(false);

    // A second frame at the same position is pure binary search over the cache.
    reads.reset();
    hud.length = 0;
    surfaceChanges = 0;
    await scrollFrame(0);
    expect(reads.count()).toBe(0);
    expect(hud).toHaveLength(0);
    expect(surfaceChanges).toBe(0);

    // Middle of the stack: 2000px scroll + 400px viewport centre lands on page 3.
    reads.reset();
    await scrollFrame(2000);
    expect(reads.count()).toBe(0);
    expect(hud).toHaveLength(1);
    expect(navigation.currentPage().pageNum).toBe(3);
    expect(hud[0]?.prev).toBe(true);
    expect(surfaceChanges).toBe(1);

    reads.reset();
    hud.length = 0;
    await scrollFrame(2000);
    expect(reads.count()).toBe(0);
    expect(hud).toHaveLength(0);

    // Bottom of the stack, including the end-of-gallery flags.
    reads.reset();
    await scrollFrame(5000);
    expect(reads.count()).toBe(0);
    expect(hud).toHaveLength(1);
    expect(navigation.currentPage().pageNum).toBe(6);
    expect(hud[0]?.last).toBe(true);
    expect(hud[0]?.next).toBe(false);
  });

  test("a resize rescans the neighbourhood and measures everything only when it left it", async () => {
    setVariedAspects();
    mountNavigation();
    const first = pages.get(`${ORIGIN}1`);
    if (first === undefined) {
      throw new Error("missing first page");
    }
    navigation.show(first);
    await appendUntil(6);

    const reads = definePageRects();
    await scrollFrame(5000);
    expect(navigation.currentPage().pageNum).toBe(6);

    window.dispatchEvent(new Event("resize"));
    reads.reset();
    hud.length = 0;
    await scrollFrame(5000);
    // Six pages, but only the four around page 6 are measured: the centre is still inside them.
    expect(reads.count()).toBe(4);
    expect(hud).toHaveLength(0);

    reads.reset();
    await scrollFrame(5000);
    expect(reads.count()).toBe(0);

    // Jumping to the top after the resize leaves the neighbourhood: one full measure follows.
    reads.reset();
    await scrollFrame(0);
    expect(reads.count()).toBe(10);
    expect(navigation.currentPage().pageNum).toBe(1);
  });
});

describe("continuous page reservations", () => {
  test("reserves each page's declared aspect and drops min-height on load", async () => {
    pages.set(`${ORIGIN}2`, page(2, { fileInfo: "1,000 KB :: 1200 x 600" }));
    pages.set(`${ORIGIN}3`, page(3, { fileInfo: "" }));
    pages.set(`${ORIGIN}4`, page(4, { fileInfo: "1,000 KB :: 640 x 480" }));
    mountNavigation();
    Object.defineProperty(container, "clientWidth", { value: 640, configurable: true });
    const first = pages.get(`${ORIGIN}1`);
    if (first === undefined) {
      throw new Error("missing first page");
    }

    navigation.show(first);
    await appendUntil(4);

    const nodes = [...container.querySelectorAll<HTMLElement>(".reader-page")];
    // 800 x 1200, 1200 x 600, an empty info bar inheriting 0.5 against the viewport, then
    // 640 x 480.
    expect(nodes.map((node) => node.style.minHeight)).toEqual(["960px", "320px", "500px", "480px"]);

    const image = nodes[0]?.querySelector("img");
    image?.onload?.(new Event("load"));
    expect(nodes[0]?.style.minHeight).toBe("");
    // Pages that have not loaded keep their reservation.
    expect(nodes[1]?.style.minHeight).toBe("320px");
  });

  test("falls back to the viewport width when the container cannot be measured", () => {
    mountNavigation();
    const first = pages.get(`${ORIGIN}1`);
    if (first === undefined) {
      throw new Error("missing first page");
    }

    navigation.show(first);

    // linkedom reports 0 for clientWidth; the reservation uses window.innerWidth (1000) instead.
    const node = container.querySelector<HTMLElement>(".reader-page");
    expect(node?.style.minHeight).toBe("1500px");
  });
});
