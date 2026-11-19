import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { installDom, installNoopObservers, requireNode } from "./dom";

const LIST_URL = "https://e-hentai.org/";
const GALLERY_PATH = "/g/111/aaaa/";

interface FakeHistory {
  state: unknown;
  length: number;
  replaceState(state: unknown, title: string, url?: string | URL | null): void;
  pushState(state: unknown, title: string, url?: string | URL | null): void;
  back(): void;
}

type Respond = () => Promise<Response>;

interface Globals {
  location: URL;
  history: FakeHistory;
  fetch: typeof fetch;
  navigator: { onLine: boolean };
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  ResizeObserver: typeof ResizeObserver;
  DOMParser: typeof DOMParser;
  GM_addStyle: (css: string) => void;
  GM_registerMenuCommand: (name: string, callback: () => void) => void;
}

const globals = globalThis as unknown as Globals;

let document: Document;
let view: Window;

/** Constructors linkedom exposes on its window; TypeScript's `Window` omits them. */
interface LinkedomConstructors {
  MutationObserver: typeof MutationObserver;
  DOMParser: typeof DOMParser;
}

function viewConstructors(): LinkedomConstructors {
  return view as unknown as LinkedomConstructors;
}
let respond: Respond;
let galleryHtml = "";
let boot: () => void;
let isFragmentOnlyChange: (current: string, next: string) => boolean;
let nativeUrl: (href: string) => string;

/**
 * A minimal `history` for linkedom, which has none. It mirrors the state it is given and moves the
 * global `location` the router reads, so `navigate` can push the gallery address the way a browser
 * would.
 */
function createHistory(): FakeHistory {
  let state: unknown = null;
  let length = 1;

  const moveTo = (url?: string | URL | null): void => {
    if (url === undefined || url === null || String(url) === "") {
      return;
    }
    globals.location = new URL(String(url), globals.location.href);
  };

  return {
    get state() {
      return state;
    },
    set state(next: unknown) {
      state = next;
    },
    get length() {
      return length;
    },
    set length(next: number) {
      length = next;
    },
    replaceState(next: unknown, _title: string, url?: string | URL | null) {
      state = next;
      moveTo(url);
    },
    pushState(next: unknown, _title: string, url?: string | URL | null) {
      state = next;
      length += 1;
      moveTo(url);
    },
    back() {
      length -= 1;
    },
  };
}

/** Dispatch a primary-button click through the document listener the shell installed. */
function click(anchor: Element): void {
  const event = Object.assign(new Event("click", { bubbles: true, cancelable: true }), {
    button: 0,
  });
  anchor.dispatchEvent(event);
}

/** Give a fixture-relative link the absolute href a real browser exposes. */
function absoluteAnchor(selector: string): HTMLAnchorElement {
  const anchor = requireNode<HTMLAnchorElement>(document, `#eh-view ${selector}`);
  const href = anchor.getAttribute("href") ?? "";
  anchor.setAttribute("href", new URL(href, globals.location.href).href);
  return anchor;
}

/**
 * Wait for a node the shell renders asynchronously. A mutation is the completion signal; polling
 * would bind the test to wall-clock timing.
 */
function waitForNode(check: () => Element | null): Promise<Element> {
  const immediate = check();
  if (immediate !== null) {
    return Promise.resolve(immediate);
  }

  const Observer = viewConstructors().MutationObserver;
  const { promise, resolve } = Promise.withResolvers<Element>();
  const observer = new Observer(() => {
    const node = check();
    if (node !== null) {
      observer.disconnect();
      resolve(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return promise;
}

const original: Record<string, unknown> = {};
const originalConsoleError = console.error;
const originalStorage = new Map<string, Parameters<typeof GM_setValue>[1]>();
const overridden = [
  "history",
  "navigator",
  "fetch",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
  "DOMParser",
  "GM_addStyle",
  "GM_registerMenuCommand",
] as const;

beforeAll(async () => {
  for (const key of ["eh:settings:v2", "eh:list-filters:v1"]) {
    originalStorage.set(key, GM_getValue(key));
  }

  // Seed the stores before `app.ts` (and `settings.ts`) first load, so the request queue starts
  // requests immediately and the background tag vocabulary stays offline.
  GM_setValue("eh:settings:v2", {
    version: 2,
    values: { netIntervalMs: 0, tagSuggestions: false },
  });
  GM_setValue("eh:list-filters:v1", {});

  const app = await import("../../src/app");
  boot = app.boot;
  isFragmentOnlyChange = app.isFragmentOnlyChange;
  nativeUrl = (await import("../../src/router")).nativeUrl;

  const [listHtml, gallery] = await Promise.all([
    Bun.file(`${import.meta.dir}/../fixtures/list.html`).text(),
    Bun.file(`${import.meta.dir}/../fixtures/gallery.html`).text(),
  ]);
  galleryHtml = gallery;

  document = installDom(LIST_URL, listHtml);
  const linkedomView = document.defaultView;
  if (linkedomView === null) {
    throw new Error("the linkedom document has no view");
  }
  view = linkedomView;
  Object.assign(view, { scrollTo: () => undefined, scrollY: 0 });
  installNoopObservers();

  for (const key of overridden) {
    original[key] = (globalThis as unknown as Record<string, unknown>)[key];
  }

  globals.history = createHistory();
  globals.navigator = { onLine: true };
  globals.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globals.cancelAnimationFrame = () => undefined;
  globals.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  globals.DOMParser = viewConstructors().DOMParser;
  globals.GM_addStyle = () => undefined;
  globals.GM_registerMenuCommand = () => undefined;

  // Every navigation goes through this seam; each scenario swaps in its own answer.
  respond = () => Promise.reject(new Error("offline"));
  globals.fetch = (() => respond()) as unknown as typeof fetch;

  // The failure scenario is expected to log its navigation error; keep the runner output clean.
  console.error = () => undefined;

  boot();
});

afterAll(() => {
  console.error = originalConsoleError;
  for (const [key, value] of originalStorage) {
    GM_setValue(key, value);
  }
  for (const key of overridden) {
    (globalThis as unknown as Record<string, unknown>)[key] = original[key];
  }
});

describe("boot", () => {
  test("renders the shell and the list fixture through app.ts", () => {
    const root = requireNode(document, "#eh-root");
    const host = requireNode(document, "#eh-view");

    expect(root.parentElement).toBe(document.body);
    expect(document.body.className).toBe("eh-body");
    expect(requireNode(document, "a.eh-skip").getAttribute("href")).toBe("#eh-view");
    expect(document.querySelectorAll("#eh-loading")).toHaveLength(1);
    expect(requireNode(document.head, 'meta[name="viewport"]').getAttribute("content")).toBe(
      "width=device-width, initial-scale=1",
    );

    expect(host.querySelectorAll(".card").length).toBeGreaterThan(0);
    expect(host.querySelector(".topbar-search input")).not.toBeNull();
    expect(host.getAttribute("aria-busy")).toBeNull();
    expect(document.body.classList.contains("is-loading")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("visibility")).toBe("");
    expect(document.title).toContain("E-Hentai");
  });

  test("loads a gallery through the router and shows the loading state until it lands", async () => {
    const host = requireNode(document, "#eh-view");
    const card = absoluteAnchor("a.card-cover");

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    respond = () => {
      started.resolve();
      return pending.promise;
    };

    click(card);
    await started.promise;

    expect(document.body.classList.contains("is-loading")).toBe(true);
    expect(host.getAttribute("aria-busy")).toBe("true");

    pending.resolve(
      new Response(galleryHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const title = await waitForNode(() => host.querySelector(".gallery-title"));
    expect(title.textContent).toContain("The Great Work");
    expect(host.querySelector(".gallery-header")).not.toBeNull();
    expect(host.querySelector(".card")).toBeNull();
    expect(host.getAttribute("aria-busy")).toBeNull();
    expect(document.body.classList.contains("is-loading")).toBe(false);
    expect(globals.location.href).toBe(`${LIST_URL.slice(0, -1)}${GALLERY_PATH}`);
  });

  test("renders the error panel with the native escape when the load fails", async () => {
    const host = requireNode(document, "#eh-view");
    const uploader = absoluteAnchor(".gallery-meta a.meta-link");
    const requested = uploader.href;

    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    click(uploader);

    const panel = await waitForNode(() => host.querySelector(".error-view"));
    expect(panel.getAttribute("role")).toBe("alert");
    expect(requireNode(panel, ".state-title").textContent).toBe("Something went wrong");
    expect(requireNode(panel, "button.btn-primary").textContent).toBe("Retry");

    const native = requireNode<HTMLAnchorElement>(panel, "a[data-native]");
    expect(native.textContent).toBe("Open native page");
    expect(native.getAttribute("href")).toBe(nativeUrl(requested));
    expect(new URL(native.getAttribute("href") ?? "").searchParams.get("eh_native")).toBe("1");
    expect(host.getAttribute("aria-busy")).toBeNull();
    expect(document.body.classList.contains("is-loading")).toBe(false);
  });
});

describe("isFragmentOnlyChange", () => {
  const base = "https://e-hentai.org/g/1/token/";

  test("accepts an in-page fragment change on the same document", () => {
    expect(isFragmentOnlyChange(base, `${base}#comments`)).toBe(true);
  });

  test("rejects a query, path or origin change", () => {
    expect(isFragmentOnlyChange(base, `${base}?p=2`)).toBe(false);
    expect(isFragmentOnlyChange(base, "https://e-hentai.org/g/2/token/")).toBe(false);
    expect(isFragmentOnlyChange(base, "https://example.com/g/1/token/")).toBe(false);
  });

  test("rejects an empty current address and an unparseable one", () => {
    expect(isFragmentOnlyChange("", `${base}#comments`)).toBe(false);
    expect(isFragmentOnlyChange("http://[", `${base}#comments`)).toBe(false);
  });
});
