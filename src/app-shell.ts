import {
  HttpError,
  isAbortError,
  LoginRequiredError,
  ParseMismatchError,
  RateLimitedError,
  RequestPurgedError,
} from "./fetch/errors";
import { log, LOG_TAG } from "./log";
import { registerMenuCommands } from "./menu";
import { isLoginPage, isNotFoundPage } from "./net/http";
import type { Route } from "./router";
import { nativeUrl, parseRoute, startLinkInterception } from "./router";
import type { RouteView } from "./routes/types";
import { getSettings } from "./settings";
import { documentTitle, siteLabel } from "./site";
import { blockSiteAds } from "./site-ads";
import { loadTagIndex } from "./tags/db";
import { showBanner } from "./ui/banner";
import { el } from "./ui/dom";
import { closeFavoriteMenu } from "./ui/favmenu";
import { loginGate } from "./ui/login-gate";
import { advancePage } from "./ui/page-advance";
import { restoreScrollWhenReady } from "./ui/scroll-restore";
import { nativePageAction, statePanel } from "./ui/state-panel";
import { trackStickyChrome } from "./ui/sticky";
import { injectStyles, isAppStyle } from "./ui/styles";
import { siteNav } from "./ui/topbar";
import { createViewLifecycle } from "./view-lifecycle";
import { resetViewMode } from "./view-mode";
import type { ViewContext } from "./views/context";

/** The browser's own address surface, as the shell uses it. */
export interface ShellLocation {
  readonly href: string;
  /** Leave the app for a different document. */
  assign(url: string): void;
  /** Replace the current document without adding an entry. */
  replace(url: string): void;
  reload(): void;
}

/** The history surface the shell reads and writes. */
export interface ShellHistory {
  readonly state: unknown;
  pushState(data: unknown, title: string, url: string): void;
  replaceState(data: unknown, title: string, url: string): void;
}

/**
 * Everything the shell reaches outside its own DOM. Production supplies the browser globals; tests
 * supply fakes, so two scenarios (or two shells) can live in one process.
 */
export interface ShellEnvironment {
  /** The current address; read it again after every history or location change. */
  url(): string;
  location: ShellLocation;
  history: ShellHistory;
  document: Document;
  navigator: Pick<Navigator, "onLine">;
  window: Window;
  /** Defer one call without depending on the global timer. */
  setTimeout(handler: () => void, timeoutMs?: number): number;
  /** Resolve and render an owned route. */
  views: { routeView: (route: Route) => RouteView<unknown> };
}

export interface AppShell {
  /** Take over the current document when it is an owned route. */
  boot(): void;
}

/**
 * True when `next` changes only the fragment of `current`, so both address the same document.
 *
 * In-page anchors fire `popstate` without a document change; the browser owns that scroll.
 */
export function isFragmentOnlyChange(current: string, next: string): boolean {
  if (current === "") {
    return false;
  }
  try {
    const from = new URL(current);
    const to = new URL(next);
    return (
      from.origin === to.origin &&
      from.pathname === to.pathname &&
      from.search === to.search &&
      from.hash !== to.hash
    );
  } catch {
    return false;
  }
}

/**
 * Build the app shell around one environment.
 *
 * Boot, navigation, popstate and error rendering share this closure's navigation state, so a test
 * (or a second document) can construct another shell instead of replacing process globals before
 * one import.
 */
export function createAppShell(env: ShellEnvironment): AppShell {
  const doc = env.document;
  const viewWindow = env.window;
  const { routeView } = env.views;

  let viewHost: HTMLElement | null = null;
  let navController: AbortController | null = null;
  let navId = 0;
  let hiding = true;
  let stopScrollRestore: (() => void) | null = null;
  let stopNativeErrorGuard: (() => void) | null = null;
  let stopSiteAds: (() => void) | null = null;

  function historyState(): Record<string, unknown> {
    const state = env.history.state;
    return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
  }

  /**
   * Restore a history position while infinite scroll appends pages.
   *
   * The first render is only page one, so the saved target clamps until later pages arrive. User
   * input cancels the retries immediately; the next navigation also stops them.
   */
  function restoreScroll(y: number): () => void {
    stopScrollRestore?.();
    const controller = new AbortController();
    let stopped = false;
    let stopRestore = (): void => undefined;

    const stop = (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      stopRestore();
      controller.abort();
      if (stopScrollRestore === stop) {
        stopScrollRestore = null;
      }
    };

    stopRestore = restoreScrollWhenReady(y, {
      advance: advancePage,
      scrollTo: (target) => viewWindow.scrollTo(0, target),
      scrollY: () => viewWindow.scrollY,
      scrollHeight: () => doc.documentElement.scrollHeight,
      frame: (callback) => viewWindow.requestAnimationFrame(callback),
      cancelFrame: (handle) => viewWindow.cancelAnimationFrame(handle),
      // Drop the input listeners as soon as the restore is done, not on the next mount.
      onDone: stop,
    });
    // A restore that finished without waiting for a frame has nothing to listen for.
    const isStopped = (): boolean => stopped;
    if (isStopped()) {
      return stop;
    }
    const options: AddEventListenerOptions = {
      once: true,
      passive: true,
      signal: controller.signal,
    };
    viewWindow.addEventListener("wheel", stop, options);
    viewWindow.addEventListener("touchstart", stop, options);
    viewWindow.addEventListener("pointerdown", stop, options);
    viewWindow.addEventListener("keydown", stop, options);
    stopScrollRestore = stop;
    return stop;
  }

  const lifecycle = createViewLifecycle({
    host: () => viewHost,
    closePanels: closeFavoriteMenu,
    resetViewMode,
    trackSticky: trackStickyChrome,
    scrollTo: (y) => viewWindow.scrollTo(0, y),
    restoreScroll,
  });

  function hideDocument(): void {
    const apply = (): void => {
      if (!hiding) {
        return;
      }
      const root: HTMLElement | null = doc.documentElement;
      // `documentElement` is null until the parser creates <html>, and this script runs at
      // document-start.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!root) {
        env.setTimeout(apply, 0);
        return;
      }
      root.style.setProperty("visibility", "hidden", "important");
      // The theme's canvas colour; the stylesheet is not injected yet at document-start.
      root.style.setProperty("background", "#34353b", "important");
    };
    apply();
  }

  /**
   * Keep the site's own image handlers from acting while its document is still being replaced.
   *
   * The viewer's page image carries `onerror="this.onerror=null; nl('…')"`, and `nl()` is a
   * full-page navigation to `?nl=<token>`. A request the old document started can fail after
   * takeover; without this guard its handler would reload the reader out from under the app. The
   * capture listener stops those errors at the window before they reach the element; `ensureShell`
   * removes it once the native nodes are gone and the app's own images (which need their error
   * handlers) exist.
   */
  function guardAgainstNativeImageErrors(): void {
    const guard = (event: Event): void => {
      const target = event.target;
      // Only the viewer's page image calls `nl()`; other scripts' image errors keep their
      // handlers.
      if (
        target instanceof Element &&
        target.localName === "img" &&
        (target.getAttribute("onerror") ?? "").includes("nl(")
      ) {
        event.stopImmediatePropagation();
      }
    };
    viewWindow.addEventListener("error", guard, true);
    stopNativeErrorGuard = () => {
      viewWindow.removeEventListener("error", guard, true);
      stopNativeErrorGuard = null;
    };
  }

  /** True when a handler property still holds the site's script, not another userscript. */
  function isNativeHandler(handler: unknown, marker: string): boolean {
    return typeof handler === "function" && handler.toString().includes(marker);
  }

  /**
   * Detach the site's document-level handlers before its nodes disappear.
   *
   * The viewer script sets `window.onresize`, `window.onpopstate` and `document.onkeydown`; all
   * three then dereference elements this app removes, and its popstate handler would issue a
   * `showpage` request for the app's own history entries (and navigate on the response). Clearing
   * the properties leaves the site's script inert while the app's `addEventListener` handlers take
   * over; handlers installed by other userscripts are left alone.
   */
  function detachNativePage(): void {
    if (isNativeHandler(viewWindow.onresize, "update_window_extents")) {
      viewWindow.onresize = null;
    }
    if (isNativeHandler(viewWindow.onpopstate, "apply_json_state")) {
      viewWindow.onpopstate = null;
    }
    if (isNativeHandler(doc.onkeydown, "holdingOverrideKey")) {
      doc.onkeydown = null;
    }
    if (isNativeHandler(doc.onkeyup, "holdingOverrideKey")) {
      doc.onkeyup = null;
    }
    // The page image still has `onerror="…nl('…')"` and an in-flight request; dropping the source
    // cancels the duplicate fetch the app is about to make itself.
    for (const image of doc.querySelectorAll<HTMLImageElement>("#i3 img, #img")) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
  }

  function revealDocument(): void {
    hiding = false;
    // Boots that fall back to the site's own page must leave its handlers alone.
    stopNativeErrorGuard?.();
    const root: HTMLElement | null = doc.documentElement;
    // See `hideDocument`: the document may still lack <html> at this point.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!root) {
      return;
    }
    root.style.removeProperty("visibility");
    root.style.removeProperty("background");
  }

  function ensureShell(): void {
    if (viewHost) {
      return;
    }

    // We own the document now; EH's stylesheet would only fight our layout. The app's own sheet was
    // injected before the route parse, so the sweep must spare it.
    for (const node of doc.head.querySelectorAll('link[rel="stylesheet"], style')) {
      if (!isAppStyle(node)) {
        node.remove();
      }
    }

    // The legacy site has no viewport meta, so mobile browsers would lay out at 980px and ignore
    // every responsive rule in the app.
    if (!doc.querySelector('meta[name="viewport"]')) {
      doc.head.append(
        el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      );
    }

    // Thumbnails come from a separate image host; opening the connection alongside the shell saves
    // a handshake before the first page's images arrive.
    if (!doc.querySelector('link[rel="preconnect"][href="https://ehgt.org"]')) {
      doc.head.append(el("link", { rel: "preconnect", href: "https://ehgt.org", crossorigin: "" }));
    }

    // The parsed data is in hand and the native DOM is about to go: retire the site's handlers and
    // its pending images first, so a late load/error cannot act on nodes that no longer exist.
    stopNativeErrorGuard?.();
    detachNativePage();

    // The site's own document and scripts are gone with the body below; keeping the document-wide
    // observer would inspect every change the app makes for the rest of its life.
    stopSiteAds?.();
    stopSiteAds = null;

    doc.body.replaceChildren();
    doc.body.className = "eh-body";
    doc.body.removeAttribute("style");

    viewHost = el("main", { id: "eh-view", tabindex: "-1" });
    const root = el("div", { id: "eh-root" }, viewHost);
    const skip = el("a", { class: "eh-skip", href: "#eh-view" }, "Skip to content");
    skip.addEventListener("click", (event) => {
      // A hash jump scrolls but leaves focus where it was, which defeats the link.
      event.preventDefault();
      viewHost?.focus({ preventScroll: true });
      viewWindow.scrollTo(0, 0);
    });

    doc.body.append(
      skip,
      root,
      el("div", { id: "eh-loading", class: "eh-loading", "aria-hidden": "true" }),
    );

    startLinkInterception(navigate, doc);
    viewWindow.addEventListener("popstate", onPopState);
    registerMenuCommands();
  }

  function setLoading(active: boolean): void {
    doc.body.classList.toggle("is-loading", active);
    if (active) {
      viewHost?.setAttribute("aria-busy", "true");
    } else {
      viewHost?.removeAttribute("aria-busy");
    }
  }

  function viewContext(route: Route, signal: AbortSignal): ViewContext {
    return {
      signal,
      navigate,
      reload: () => {
        void transition(route, viewWindow.scrollY, { fresh: true });
      },
      setLeaveGuard: (guard) => {
        lifecycle.setLeaveGuard(guard);
      },
    };
  }

  function present(
    route: Route,
    view: RouteView<unknown>,
    data: unknown,
    scrollY: number | null,
    focus = false,
  ): void {
    lifecycle.mount({
      route,
      title: view.title(data),
      scrollY,
      focus,
      render: (host, signal) => {
        view.render(host, data, viewContext(route, signal), route);
      },
    });
  }

  function errorView(error: unknown, route: Route): void {
    if (!viewHost) {
      return;
    }

    let title = "Something went wrong";
    let message: string;
    let detail: string | undefined;

    if (error instanceof RateLimitedError) {
      title = "Rate limited";
      message = "The site is throttling requests from this connection. Wait a moment, then retry.";
      showBanner(error.text);
    } else if (error instanceof RequestPurgedError) {
      title = "Requests paused";
      message =
        "The site is throttling requests from this connection, so this page was not loaded. " +
        "Wait a moment, then retry.";
    } else if (error instanceof LoginRequiredError) {
      title = "Sign in required";
      message = `This page is not available to guests. Sign in to ${siteLabel()} and try again.`;
    } else if (error instanceof HttpError && error.status === 404) {
      title = "Page not found";
      message = "The site does not serve this page. It may have moved, or the link may be wrong.";
    } else if (error instanceof HttpError) {
      message = `The site answered with an error (HTTP ${error.status}).`;
    } else if (!env.navigator.onLine) {
      title = "You appear to be offline";
      message = "Check your connection, then retry.";
    } else {
      // The raw text ("Failed to fetch", a parser stack) belongs in the console, not on screen.
      console.error(LOG_TAG, "unhandled route error", error);
      message = "The page could not be loaded. Retry, or open the site's own version below.";
      detail = "If this keeps happening, the site layout may have changed.";
    }

    const native = nativeUrl(route.url);
    const pageTitle = documentTitle(title);

    if (error instanceof LoginRequiredError) {
      lifecycle.mount({
        route,
        title: pageTitle,
        focus: true,
        render: (host, signal) => {
          host.append(siteNav(signal), loginGate({ title, message, nativeHref: native }));
        },
      });
      return;
    }

    lifecycle.mount({
      route,
      title: pageTitle,
      focus: true,
      render: (host, signal) => {
        host.append(
          siteNav(signal),
          statePanel({
            tone: "error",
            headingLevel: 1,
            title,
            text: message,
            detail,
            actions: [
              {
                label: "Retry",
                primary: true,
                onClick: () => {
                  void transition(parseRoute(env.location.href, env.url()), null);
                },
              },
              nativePageAction(native),
            ],
          }),
        );
      },
    });
  }

  function saveScroll(): void {
    env.history.replaceState(
      { ...historyState(), eh: true, scrollY: viewWindow.scrollY },
      "",
      env.url(),
    );
  }

  async function transition(
    route: Route,
    scrollY: number | null,
    options: { fresh?: boolean } = {},
  ): Promise<void> {
    const id = ++navId;
    navController?.abort();
    navController = new AbortController();
    setLoading(true);

    try {
      const view = routeView(route);
      const data = await view.load(route, navController.signal, options);
      if (id !== navId) {
        return;
      }
      present(route, view, data, scrollY, true);
    } catch (error) {
      if (id !== navId || isAbortError(error)) {
        return;
      }
      if (error instanceof ParseMismatchError) {
        // The owned view cannot trust this document. Replace the entry with the site's own page so
        // the back button cannot land on the owned URL and fall back again.
        console.error(LOG_TAG, "parse mismatch, opening the native page", error);
        env.location.replace(nativeUrl(route.url));
        return;
      }
      console.error(LOG_TAG, "navigation failed", error);
      errorView(error, route);
    } finally {
      if (id === navId) {
        setLoading(false);
      }
    }
  }

  function navigate(url: string, options: { replace?: boolean } = {}): void {
    const route = parseRoute(url, env.url());
    if (!lifecycle.guard()) {
      return;
    }

    if (route.kind === "native") {
      env.location.assign(url);
      return;
    }

    const replace = options.replace === true;
    const prepared = routeView(route).prepare(route, {
      previous: lifecycle.currentRoute(),
      replace,
      previousState: historyState(),
    });
    saveScroll();
    const state = { eh: true, scrollY: 0, ...prepared.state };
    if (replace) {
      env.history.replaceState(state, "", prepared.route.url);
    } else {
      env.history.pushState(state, "", prepared.route.url);
    }

    void transition(prepared.route, null);
  }

  function onPopState(event: PopStateEvent): void {
    const currentUrl = lifecycle.currentRoute()?.url ?? "";
    const route = parseRoute(env.location.href, env.url());
    if (route.kind === "native") {
      // Back or forward onto an entry the app does not own would unload the document, so the
      // view's leave guard runs before the browser is allowed to reload it.
      if (!lifecycle.guard()) {
        env.history.pushState(event.state, "", currentUrl);
        return;
      }
      env.location.reload();
      return;
    }

    // A `#section` jump fires popstate without changing the document. Re-rendering would refetch,
    // replace the section node and scroll back to the top.
    if (isFragmentOnlyChange(currentUrl, env.location.href)) {
      return;
    }

    // A view with unsaved state keeps the entry it already renders.
    if (!lifecycle.guard()) {
      env.history.pushState(event.state, "", currentUrl);
      return;
    }

    const prepared = routeView(route).prepare(route, {
      previous: lifecycle.currentRoute(),
      replace: false,
      previousState: historyState(),
    });
    if (prepared.route.url !== env.location.href) {
      env.history.replaceState(event.state, "", prepared.route.url);
    }
    const state = event.state as { scrollY?: number } | null;
    void transition(prepared.route, state?.scrollY ?? 0);
  }

  /** Run a warm-up once the browser is idle; engines without the API get a task instead. */
  function whenIdle(callback: () => void): void {
    // Safari (and test doubles) can lack the API even though the DOM types require it.
    const idle = Reflect.get(viewWindow, "requestIdleCallback") as
      ((run: () => void) => number) | undefined;
    if (idle !== undefined) {
      idle.call(viewWindow, callback);
      return;
    }
    env.setTimeout(callback, 0);
  }

  function startOwned(initialRoute: Route): void {
    const view = routeView(initialRoute);

    // Start the app's sheet parsing before the parse and render below; `ensureShell` spares it when
    // it removes the site's own sheets.
    injectStyles();

    if (isLoginPage(doc)) {
      throw new LoginRequiredError();
    }

    // A host that does not serve this path hands us its own 404 page instead of an HTTP error.
    if (isNotFoundPage(doc)) {
      ensureShell();
      errorView(new HttpError(404, env.location.href), initialRoute);
      revealDocument();
      return;
    }

    const initial = view.parse(doc, initialRoute);
    view.seed?.(initialRoute, initial);
    ensureShell();
    env.history.replaceState({ eh: true, scrollY: 0 }, "", env.location.href);
    try {
      present(initialRoute, view, initial, 0, false);
    } catch (error) {
      console.error(LOG_TAG, "initial render failed", error);
      errorView(error, initialRoute);
    }
    revealDocument();
    // Warm the full vocabulary so the first focus on the search field is not limited to the core.
    // The download is large, so it waits until the boot render has the browser's idle time.
    if (getSettings().tagSuggestions) {
      whenIdle(() => {
        void loadTagIndex().catch((error: unknown) => log("tag index prefetch failed", error));
      });
    }
    log("ready", getSettings().fitHeight ? "fit-height" : "natural-width");
  }

  return {
    boot(): void {
      const route = parseRoute(env.url(), env.url());
      if (route.kind === "native") {
        return;
      }

      // Native routes keep the site's own page, ads included; owned routes do not need its loader.
      stopSiteAds = blockSiteAds();
      hideDocument();
      guardAgainstNativeImageErrors();

      // The row decides whether this document can render or the browser must load another address
      // first: a bare listing needs its remembered filters, and a range starts at the site cursor.
      const prepared = routeView(route).prepare(route, {
        previous: null,
        replace: true,
        previousState: {},
      });
      if (prepared.bootUrl !== null) {
        env.location.replace(prepared.bootUrl);
        return;
      }

      const start = (): void => {
        try {
          startOwned(prepared.route);
        } catch (error) {
          console.error(LOG_TAG, "startup failed", error);
          if (error instanceof ParseMismatchError) {
            // The document is hidden and the shell may not exist yet; the site's own page is
            // next.
            revealDocument();
            env.location.replace(nativeUrl(env.location.href));
            return;
          }
          // A signed-out first load has no shell yet, so the site's own login wall would stay
          // visible.
          if (error instanceof LoginRequiredError) {
            ensureShell();
            errorView(error, prepared.route);
          }
          revealDocument();
        }
      };

      if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", start, { once: true });
      } else {
        start();
      }
    },
  };
}
