import { beforeEach, describe, expect, test } from "bun:test";

import { createAppShell, isFragmentOnlyChange } from "../../src/app-shell";
import type { ShellEnvironment } from "../../src/app-shell";
import {
  HttpError,
  LoginRequiredError,
  RateLimitedError,
  RequestPurgedError,
} from "../../src/fetch/errors";
import type { DocumentOptions, HtmlResponse, ViewerPageOptions } from "../../src/fetch/loader";
import type { Route } from "../../src/router";
import { nativeUrl, parseRoute } from "../../src/router";
import { createRouteViews } from "../../src/routes";
import type { LoadOptions } from "../../src/routes/types";
import { updateSettings } from "../../src/settings";
import type { PageData } from "../../src/types";
import { loadFixture } from "../dom";
import { installDom, installNoopObservers, requireNode } from "./dom";

const LIST_URL = "https://e-hentai.org/";
const GALLERY_URL = "https://e-hentai.org/g/111/aaaa/";

const listHtml = await Bun.file(`${import.meta.dir}/../fixtures/list.html`).text();
const pristineList = await loadFixture("list.html");
const galleryDoc = await loadFixture("gallery.html");

type Respond = (url: string) => Promise<HtmlResponse>;

interface FakeHistory {
  state: unknown;
  replaceState(state: unknown, title: string, url?: string | URL | null): void;
  pushState(state: unknown, title: string, url?: string | URL | null): void;
}

/** Linkedom's window carries constructors TypeScript's `Window` omits. */
interface WindowConstructors {
  MutationObserver: typeof MutationObserver;
}

function windowConstructors(view: Window): WindowConstructors {
  return view as unknown as WindowConstructors;
}

interface Harness {
  document: Document;
  view: Window;
  host: HTMLElement;
  url: () => string;
  history: FakeHistory;
  /** Move to `href` as a browser back/forward would, then dispatch popstate with `state`. */
  go(href: string, state: unknown): void;
  /** Requests the route loader made, in order. */
  loads: string[];
  /** Load a route through the same adapters the shell uses, with optional cache options. */
  load(route: Route, options?: LoadOptions): Promise<unknown>;
  setRespond(respond: Respond): void;
  setOnline(online: boolean): void;
}

let respond: Respond = () => Promise.resolve({ doc: galleryDoc, url: GALLERY_URL });

function construct(): Harness {
  const document = installDom(LIST_URL, listHtml);
  installNoopObservers();
  const view = document.defaultView;
  if (view === null) {
    throw new Error("the linkedom document has no view");
  }

  const globals = globalThis as unknown as Record<string, unknown>;
  let current = new URL(LIST_URL);
  const moveTo = (next: string | URL | null | undefined): void => {
    if (next === undefined || next === null || String(next) === "") {
      return;
    }
    current = new URL(String(next), current.href);
    // UI modules still resolve relative links and the site label through the global.
    globals.location = current;
  };

  const location = {
    get href() {
      return current.href;
    },
    assign: moveTo,
    replace: moveTo,
    reload: () => undefined,
  };
  const history: FakeHistory = {
    state: null,
    replaceState(next, _title, nextUrl) {
      history.state = next;
      moveTo(nextUrl);
    },
    pushState(next, _title, nextUrl) {
      history.state = next;
      moveTo(nextUrl);
    },
  };

  Object.assign(view, {
    scrollTo: () => undefined,
    scrollY: 0,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
  });

  // The viewer script leaves these handlers on the document. Their source carries the markers the
  // app checks, so the takeover must clear exactly these and not another script's properties.
  document.onkeydown = function holdingOverrideKey(): void {};
  view.onresize = function update_window_extents(): void {};
  view.onpopstate = function apply_json_state(): void {};
  const nativeImage = document.createElement("img");
  nativeImage.id = "img";
  nativeImage.onerror = () => undefined;
  nativeImage.onload = () => undefined;
  nativeImage.setAttribute("src", "https://img.example/native-page.jpg");
  document.body.append(nativeImage);

  const loads: string[] = [];
  const navigatorState = { onLine: true };
  let active: Respond = respond;
  const views = createRouteViews({
    document: (requestUrl: string, _options?: DocumentOptions) => {
      loads.push(requestUrl);
      return active(requestUrl);
    },
    viewerPage: (_requestUrl: string, _options?: ViewerPageOptions) =>
      Promise.reject<PageData>(new Error("unexpected viewer load")),
    seedViewerPage: () => undefined,
  });

  const env: ShellEnvironment = {
    url: () => current.href,
    location,
    history,
    document,
    navigator: navigatorState,
    window: view,
    // The shell only defers until <html> exists, which linkedom always provides.
    setTimeout: (handler) => {
      handler();
      return 0;
    },
    views,
  };
  createAppShell(env).boot();

  const host = requireNode<HTMLElement>(document, "#eh-view");
  return {
    document,
    view,
    host,
    url: () => current.href,
    history,
    go(href, state) {
      moveTo(href);
      history.state = state;
      const event = Object.assign(new Event("popstate"), { state });
      view.dispatchEvent(event);
    },
    loads,
    load(route, options) {
      return views.routeView(route).load(route, new AbortController().signal, options);
    },
    setRespond(next) {
      active = next;
    },
    setOnline(online) {
      navigatorState.onLine = online;
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
function absoluteAnchor(harness: Harness, selector: string): HTMLAnchorElement {
  const anchor = requireNode<HTMLAnchorElement>(harness.document, `#eh-view ${selector}`);
  const href = anchor.getAttribute("href") ?? "";
  anchor.setAttribute("href", new URL(href, harness.url()).href);
  return anchor;
}

/** Wait for a node the shell renders asynchronously; a mutation is the completion signal. */
function waitForNode(
  document: Document,
  view: Window,
  check: () => Element | null,
): Promise<Element> {
  const immediate = check();
  if (immediate !== null) {
    return Promise.resolve(immediate);
  }

  const Observer = windowConstructors(view).MutationObserver;
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

beforeEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.GM_addStyle = () => undefined;
  globals.GM_registerMenuCommand = () => undefined;
  globals.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  for (const key of ["eh:settings:v2", "eh:list-filters:v1"]) {
    GM_setValue(key, null);
  }
  updateSettings({ netIntervalMs: 0, tagSuggestions: false });
  respond = () => Promise.resolve({ doc: galleryDoc, url: GALLERY_URL });
});

describe("boot shell", () => {
  test("boots the shell from one injected environment and leaves the site's page behind", () => {
    const { document, view, host } = construct();

    expect(requireNode(document, "a.eh-skip").getAttribute("href")).toBe("#eh-view");
    expect(host.querySelectorAll(".card").length).toBeGreaterThan(0);
    expect(host.querySelector(".topbar-search input")).not.toBeNull();
    const preconnect = document.querySelector('link[rel="preconnect"][href="https://ehgt.org"]');
    expect(preconnect?.getAttribute("crossorigin")).toBe("");
    expect(document.title).toContain("E-Hentai");
    expect(document.documentElement.style.getPropertyValue("visibility")).toBe("");

    // The site's viewer handlers and its pending page image must not outlive the takeover.
    expect(document.onkeydown).toBeNull();
    expect(view.onresize).toBeNull();
    expect(view.onpopstate).toBeNull();
    expect(document.querySelector("#img")).toBeNull();
  });

  test("loads a gallery through the router and shows the loading state until it lands", async () => {
    const harness = construct();
    const { host } = harness;
    const pending = Promise.withResolvers<HtmlResponse>();
    const started = Promise.withResolvers<void>();
    harness.setRespond(() => {
      started.resolve();
      return pending.promise;
    });

    click(absoluteAnchor(harness, "a.card-cover"));
    await started.promise;

    expect(harness.document.body.classList.contains("is-loading")).toBe(true);
    expect(host.getAttribute("aria-busy")).toBe("true");

    pending.resolve({ doc: galleryDoc, url: GALLERY_URL });

    const title = await waitForNode(harness.document, harness.view, () =>
      host.querySelector(".gallery-title"),
    );
    expect(title.textContent).toContain("The Great Work");
    expect(host.querySelector(".gallery-header")).not.toBeNull();
    expect(host.querySelector(".card")).toBeNull();
    expect(host.getAttribute("aria-busy")).toBeNull();
    expect(harness.document.body.classList.contains("is-loading")).toBe(false);
    expect(harness.url()).toBe(GALLERY_URL);
    // The pushed entry marks the app's own history, with no stored position.
    expect(harness.history.state).toEqual({ eh: true, scrollY: 0 });
  });

  test("renders the error panel with the native escape when the load fails", async () => {
    const harness = construct();
    const { document, host } = harness;
    // Boot a gallery first so the uploader link exists, then fail its listing load.
    harness.setRespond(() => Promise.resolve({ doc: galleryDoc, url: GALLERY_URL }));
    click(absoluteAnchor(harness, "a.card-cover"));
    await waitForNode(document, harness.view, () => host.querySelector(".gallery-title"));

    const uploaderLink = host.querySelector<HTMLAnchorElement>(".gallery-meta a.meta-link");
    if (uploaderLink === null) {
      throw new Error("missing uploader link");
    }
    const requested = new URL(uploaderLink.getAttribute("href") ?? "", harness.url()).href;
    harness.setRespond(() => Promise.reject(new TypeError("Failed to fetch")));
    const originalError = console.error;
    console.error = () => undefined;
    let panel: Element;
    try {
      click(uploaderLink);
      panel = await waitForNode(document, harness.view, () => host.querySelector(".error-view"));
    } finally {
      console.error = originalError;
    }
    expect(panel.getAttribute("role")).toBe("alert");
    expect(requireNode(panel, ".state-title").textContent).toBe("Something went wrong");
    expect(requireNode(panel, "button.btn-primary").textContent).toBe("Retry");

    const native = requireNode<HTMLAnchorElement>(panel, "a[data-native]");
    expect(native.textContent).toBe("Open native page");
    expect(native.getAttribute("href")).toBe(nativeUrl(requested));
    expect(new URL(native.getAttribute("href") ?? "").searchParams.get("eh_native")).toBe("1");
    expect(host.getAttribute("aria-busy")).toBeNull();
    expect(document.body.classList.contains("is-loading")).toBe(false);

    // Retry crosses the same environment again.
    harness.setRespond((address) => Promise.resolve({ doc: pristineList, url: address }));
    click(requireNode(panel, "button.btn-primary"));
    await waitForNode(document, harness.view, () => host.querySelector(".card"));
    expect(host.querySelector(".error-view")).toBeNull();
  });

  test("reports an offline connection from the injected navigator", async () => {
    const harness = construct();
    const { document, host } = harness;
    harness.setOnline(false);
    harness.setRespond(() => Promise.reject(new TypeError("Failed to fetch")));
    const originalError = console.error;
    console.error = () => undefined;
    try {
      click(absoluteAnchor(harness, "a.card-cover"));
      const panel = await waitForNode(document, harness.view, () =>
        host.querySelector(".error-view"),
      );
      expect(requireNode(panel, ".state-title").textContent).toBe("You appear to be offline");
      expect(requireNode(panel, ".state-text").textContent).toContain("Check your connection");
    } finally {
      console.error = originalError;
    }
  });

  const errorCases = [
    {
      name: "rate limit",
      error: (): Error => new RateLimitedError("Too many requests"),
      title: "Rate limited",
      text: "throttling requests",
    },
    {
      name: "purged queue",
      error: (): Error => new RequestPurgedError(),
      title: "Requests paused",
      text: "not loaded",
    },
    {
      name: "404",
      error: (): Error => new HttpError(404, GALLERY_URL),
      title: "Page not found",
      text: "does not serve",
    },
    {
      name: "other HTTP",
      error: (): Error => new HttpError(500, GALLERY_URL),
      title: "Something went wrong",
      text: "HTTP 500",
    },
  ] as const;

  for (const scenario of errorCases) {
    test(`maps a ${scenario.name} failure to its own panel`, async () => {
      const harness = construct();
      const { document, host } = harness;
      harness.setRespond(() => Promise.reject(scenario.error()));
      const originalError = console.error;
      console.error = () => undefined;
      try {
        click(absoluteAnchor(harness, "a.card-cover"));
        const panel = await waitForNode(document, harness.view, () =>
          host.querySelector(".error-view"),
        );
        expect(requireNode(panel, ".state-title").textContent).toBe(scenario.title);
        expect(requireNode(panel, ".state-text").textContent).toContain(scenario.text);
        if (scenario.name === "rate limit") {
          expect(document.querySelector(".eh-banner-text")?.textContent).toContain(
            "Too many requests",
          );
        }
      } finally {
        console.error = originalError;
      }
    });
  }

  test("maps a login wall to the sign-in gate", async () => {
    const harness = construct();
    const { document, host } = harness;
    harness.setRespond(() => Promise.reject(new LoginRequiredError()));
    const originalError = console.error;
    console.error = () => undefined;
    let panel: Element;
    try {
      click(absoluteAnchor(harness, "a.card-cover"));
      panel = await waitForNode(document, harness.view, () => host.querySelector(".empty-state"));
    } finally {
      console.error = originalError;
    }
    expect(requireNode(panel, ".state-title").textContent).toBe("Sign in required");
    const signIn = requireNode<HTMLAnchorElement>(panel, "a.btn-primary");
    expect(signIn.textContent).toBe("Sign in");
    expect(signIn.getAttribute("href")).toBe(
      "https://forums.e-hentai.org/index.php?act=Login&CODE=00",
    );
  });

  test("back and forward move through the injected history", async () => {
    const harness = construct();
    const { document, host } = harness;
    harness.setRespond((requested) =>
      Promise.resolve({
        doc: requested.startsWith("https://e-hentai.org/g/") ? galleryDoc : pristineList,
        url: requested,
      }),
    );

    harness.go(GALLERY_URL, { eh: true, scrollY: 0 });
    await waitForNode(document, harness.view, () => host.querySelector(".gallery-title"));
    expect(harness.url()).toBe(GALLERY_URL);

    const listLoads = harness.loads.filter((url) => url === LIST_URL).length;
    harness.go(LIST_URL, { eh: true, scrollY: 0 });
    await waitForNode(document, harness.view, () => host.querySelector(".card"));
    expect(harness.url()).toBe(LIST_URL);
    // The boot's parsed page is seeded, so going back re-renders it instead of refetching.
    expect(harness.loads.filter((url) => url === LIST_URL).length).toBe(listLoads);
    expect(host.querySelector(".gallery-title")).toBeNull();
  });

  test("a fresh load bypasses the data parsed at boot", async () => {
    const harness = construct();
    harness.setRespond((requested) =>
      Promise.resolve({
        doc: requested === LIST_URL ? pristineList : galleryDoc,
        url: requested,
      }),
    );
    const route = parseRoute(LIST_URL, LIST_URL);
    const listLoads = (): number => harness.loads.filter((url) => url === LIST_URL).length;

    await harness.load(route);
    expect(listLoads()).toBe(0);

    await harness.load(route, { fresh: true });
    expect(listLoads()).toBe(1);
  });
});

describe("isFragmentOnlyChange", () => {
  const base = "https://e-hentai.org/g/1/token/";

  test("accepts an in-page fragment change on the same document", () => {
    expect(isFragmentOnlyChange(base, `${base}#comments`)).toBe(true);
    expect(isFragmentOnlyChange(`${base}#comments`, `${base}#similar`)).toBe(true);
  });

  test("rejects a query, path or origin change and unusable addresses", () => {
    expect(isFragmentOnlyChange(base, `${base}?p=2`)).toBe(false);
    expect(isFragmentOnlyChange(base, "https://e-hentai.org/g/2/token/")).toBe(false);
    expect(isFragmentOnlyChange(base, "https://example.com/g/1/token/")).toBe(false);
    expect(isFragmentOnlyChange("", `${base}#comments`)).toBe(false);
    expect(isFragmentOnlyChange("http://[", `${base}#comments`)).toBe(false);
  });
});
