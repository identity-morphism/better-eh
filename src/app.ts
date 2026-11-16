import { applyPersistedListFilters } from "./data/list-filters";
import {
  HttpError,
  isAbortError,
  LoginRequiredError,
  RateLimitedError,
  RequestPurgedError,
} from "./fetch/errors";
import { log, LOG_TAG } from "./log";
import { registerMenuCommands } from "./menu";
import { isLoginPage, isNotFoundPage } from "./net/http";
import type { Route } from "./router";
import { nativeUrl, parseRoute, startLinkInterception } from "./router";
import { routeView } from "./routes";
import type { RouteView } from "./routes";
import { getSettings } from "./settings";
import { documentTitle, siteLabel } from "./site";
import { blockSiteAds } from "./site-ads";
import { showBanner } from "./ui/banner";
import { el } from "./ui/dom";
import { closeFavoriteMenu } from "./ui/favmenu";
import { loginGate } from "./ui/login-gate";
import { restoreScrollWhenReady } from "./ui/scroll-restore";
import { nativePageAction, statePanel } from "./ui/state-panel";
import { trackStickyChrome } from "./ui/sticky";
import { injectStyles } from "./ui/styles";
import { siteNav } from "./ui/topbar";
import { createViewLifecycle } from "./view-lifecycle";
import { resetViewMode } from "./view-mode";
import type { ViewContext } from "./views/context";

let viewHost: HTMLElement | null = null;
let navController: AbortController | null = null;
let navId = 0;

let hiding = true;
let stopScrollRestore: (() => void) | null = null;

/**
 * Restore a history position while infinite scroll appends pages.
 *
 * The first render is only page one, so the saved target clamps until later pages arrive. User
 * input cancels the retries immediately; the next navigation also stops them.
 */
function restoreScroll(y: number): () => void {
  stopScrollRestore?.();
  const restore = restoreScrollWhenReady(y);
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
    restore();
  };
  const options: AddEventListenerOptions = { once: true, passive: true, signal: controller.signal };
  window.addEventListener("wheel", stop, options);
  window.addEventListener("touchstart", stop, options);
  window.addEventListener("pointerdown", stop, options);
  window.addEventListener("keydown", stop, options);
  stopScrollRestore = stop;
  return stop;
}

const lifecycle = createViewLifecycle({
  host: () => viewHost,
  closePanels: closeFavoriteMenu,
  resetViewMode,
  trackSticky: trackStickyChrome,
  scrollTo: (y) => {
    window.scrollTo(0, y);
  },
  restoreScroll,
});

function hideDocument(): void {
  const apply = (): void => {
    if (!hiding) {
      return;
    }
    const root: HTMLElement | null = document.documentElement;
    // `documentElement` is null until the parser creates <html>, and this script runs at
    // document-start.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!root) {
      setTimeout(apply, 0);
      return;
    }
    root.style.setProperty("visibility", "hidden", "important");
    // The theme's canvas colour; the stylesheet is not injected yet at document-start.
    root.style.setProperty("background", "#34353b", "important");
  };
  apply();
}

function revealDocument(): void {
  hiding = false;
  const root: HTMLElement | null = document.documentElement;
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

  // We own the document now; EH's stylesheet would only fight our layout.
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    node.remove();
  }

  // The legacy site has no viewport meta, so mobile browsers would lay out at 980px and ignore
  // every responsive rule in the app.
  if (!document.querySelector('meta[name="viewport"]')) {
    document.head.append(
      el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    );
  }

  document.body.replaceChildren();
  document.body.className = "eh-body";
  document.body.removeAttribute("style");

  viewHost = el("main", { id: "eh-view", tabindex: "-1" });
  const root = el("div", { id: "eh-root" }, viewHost);
  const skip = el("a", { class: "eh-skip", href: "#eh-view" }, "Skip to content");
  skip.addEventListener("click", (event) => {
    // A hash jump scrolls but leaves focus where it was, which defeats the link.
    event.preventDefault();
    viewHost?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  document.body.append(
    skip,
    root,
    el("div", { id: "eh-loading", class: "eh-loading", "aria-hidden": "true" }),
  );

  startLinkInterception(navigate);
  window.addEventListener("popstate", onPopState);
  registerMenuCommands();
  injectStyles();
}

function setLoading(active: boolean): void {
  document.body.classList.toggle("is-loading", active);
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
      void transition(route, window.scrollY, { fresh: true });
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
      view.render(host, data, viewContext(route, signal));
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
  } else if (!navigator.onLine) {
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
                void transition(parseRoute(location.href), null);
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
  const state = (history.state ?? {}) as Record<string, unknown>;
  history.replaceState({ ...state, eh: true, scrollY: window.scrollY }, "", location.href);
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
    console.error(LOG_TAG, "navigation failed", error);
    errorView(error, route);
  } finally {
    if (id === navId) {
      setLoading(false);
    }
  }
}

function navigate(url: string, options: { replace?: boolean } = {}): void {
  let route = parseRoute(url);
  if (!lifecycle.guard()) {
    return;
  }

  if (route.kind === "native") {
    location.href = url;
    return;
  }

  route = applyPersistedListFilters(route);
  saveScroll();
  // The reader's back action can pop the gallery entry instead of pushing a fresh paged URL; keep
  // that marker across the viewer's own replace-navigations (next/previous page).
  const fromGallery = route.kind === "viewer" && lifecycle.currentRoute()?.kind === "gallery";
  const previous = (history.state ?? {}) as { fromGallery?: boolean };
  const state = {
    eh: true,
    scrollY: 0,
    fromGallery: options.replace ? previous.fromGallery === true : fromGallery,
  };
  if (options.replace) {
    history.replaceState(state, "", route.url);
  } else {
    history.pushState(state, "", route.url);
  }

  void transition(route, null);
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

function onPopState(event: PopStateEvent): void {
  const currentUrl = lifecycle.currentRoute()?.url ?? "";
  let route = parseRoute(location.href);
  if (route.kind === "native") {
    // Back or forward onto an entry the app does not own would unload the document, so the
    // view's leave guard runs before the browser is allowed to reload it.
    if (!lifecycle.guard()) {
      history.pushState(event.state, "", currentUrl);
      return;
    }
    location.reload();
    return;
  }

  // A `#section` jump fires popstate without changing the document. Re-rendering would refetch,
  // replace the section node and scroll back to the top.
  if (isFragmentOnlyChange(currentUrl, location.href)) {
    return;
  }

  // A view with unsaved state keeps the entry it already renders.
  if (!lifecycle.guard()) {
    history.pushState(event.state, "", currentUrl);
    return;
  }

  route = applyPersistedListFilters(route);
  if (route.url !== location.href) {
    history.replaceState(event.state, "", route.url);
  }
  const state = event.state as { scrollY?: number } | null;
  void transition(route, state?.scrollY ?? 0);
}

function startOwned(initialRoute: Route): void {
  const view = routeView(initialRoute);

  if (isLoginPage(document)) {
    throw new LoginRequiredError();
  }

  // A host that does not serve this path hands us its own 404 page instead of an HTTP error.
  if (isNotFoundPage(document)) {
    ensureShell();
    errorView(new HttpError(404, location.href), initialRoute);
    revealDocument();
    return;
  }

  const initial = view.parse(document, initialRoute);
  ensureShell();
  history.replaceState({ eh: true, scrollY: 0 }, "", location.href);
  try {
    present(initialRoute, view, initial, 0, false);
  } catch (error) {
    console.error(LOG_TAG, "initial render failed", error);
    errorView(error, initialRoute);
  }
  revealDocument();
  log("ready", getSettings().fitHeight ? "fit-height" : "natural-width");
}

export function boot(): void {
  let route = parseRoute(location.href);
  if (route.kind === "native") {
    return;
  }

  // Native routes keep the site's own page, ads included; owned routes do not need its loader.
  blockSiteAds();
  hideDocument();

  // A cold load of a bare listing cannot be filtered without refetching, so let the browser ask
  // for the remembered URL instead of rendering the unfiltered document and then replacing it.
  const effective = applyPersistedListFilters(route);
  if (effective !== route) {
    location.replace(effective.url);
    return;
  }
  route = effective;

  const start = (): void => {
    try {
      startOwned(route);
    } catch (error) {
      console.error(LOG_TAG, "startup failed", error);
      // A signed-out first load has no shell yet, so the site's own login wall would stay visible.
      if (error instanceof LoginRequiredError) {
        ensureShell();
        errorView(error, route);
      }
      revealDocument();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
