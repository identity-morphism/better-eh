import { matchOwnedRoute } from "./routes";
import type { ListScope, Route } from "./routes/types";

export type { ListScope, Route };
export { nativeUrl } from "./routes/identity";

/**
 * Classify an address the reader may own. Anything outside the site's origin, explicitly marked
 * native, or not matched by the route table stays with the site.
 */
export function parseRoute(href: string): Route {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return { kind: "native", url: href };
  }

  if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) {
    return { kind: "native", url: url.href };
  }
  if (url.searchParams.has("eh_native")) {
    return { kind: "native", url: url.href };
  }

  return matchOwnedRoute(url) ?? { kind: "native", url: url.href };
}

/** Intercept clicks on links that the app can render without a full reload. */
export function startLinkInterception(navigate: (url: string) => void): void {
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const anchor =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) {
      return;
    }
    if (anchor.dataset.native !== undefined || anchor.hasAttribute("download")) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    // In-page anchors (`#section`) are browser work, not a route change.
    const rawHref = anchor.getAttribute("href") ?? "";
    if (rawHref.startsWith("#")) {
      return;
    }

    const href = anchor.href;
    if (!href.startsWith("http")) {
      return;
    }

    const route = parseRoute(href);
    if (route.kind === "native") {
      return;
    }

    event.preventDefault();
    navigate(href);
  };

  document.addEventListener("click", onClick);
}
