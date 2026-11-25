import type { Child } from "./dom";
import { el } from "./dom";
import { listHeader } from "./list-header";
import { siteNav } from "./topbar";

interface PageScaffoldOptions {
  title: string;
  /** One summary line or several badges. */
  summary: readonly Child[];
  signal: AbortSignal;
}

/**
 * Clear the host and stack the chrome every listing page opens with: the slim site nav and the
 * shared heading. Returns the host so the caller can append its own body.
 */
export function pageScaffold(host: HTMLElement, options: PageScaffoldOptions): HTMLElement {
  host.replaceChildren(
    siteNav(options.signal),
    listHeader({ title: options.title, summary: options.summary }),
  );
  return host;
}

/** The link from a gallery sub-page back to its gallery; each page keeps its own class. */
export function galleryBackLink(href: string, className: string): HTMLElement {
  return el("a", { class: className, href, text: "Back to gallery" });
}
