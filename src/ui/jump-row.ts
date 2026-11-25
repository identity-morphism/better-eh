/**
 * Keep an in-page jump row in step with the page.
 *
 * Shared by the settings form and the toplist overview: both stack many sections under a sticky
 * header, so the row has to say which block is currently being read instead of being a dead list of
 * anchors.
 */

import type { FrameHandle } from "./frame";
import { cancelFrame, requestFrame } from "./frame";

/** A jump row and the sections it targets, index-aligned. */
interface JumpRow {
  row: HTMLElement;
  links: readonly HTMLElement[];
  sections: readonly HTMLElement[];
}

/** Where a section counts as current: the line `trackStickyChrome` publishes. */
function readingLine(): number {
  const line = Number.parseInt(
    document.documentElement.style.getPropertyValue("--sticky-reading-line"),
    10,
  );
  return Number.isFinite(line) && line > 0 ? line : 96;
}

/**
 * Publish the two scroll edges a jump row's mask needs.
 *
 * At the start only the right edge fades; once scrolled, both edges need it; at the end only the
 * leading edge is hiding content. The attributes let one stylesheet handle every row without
 * measuring in CSS.
 */
export function syncScrollEdges(row: HTMLElement): void {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  row.toggleAttribute("data-scrollable", max > 1);
  row.toggleAttribute("data-scrolled", row.scrollLeft > 1);
  row.toggleAttribute("data-at-end", max > 1 && row.scrollLeft >= max - 1);
}

/**
 * Track a horizontally scrollable row that is not a section jump list, such as the active-filter
 * chips. The listener lives with the row (or with the view signal); one animation frame syncs the
 * initial overflow state after the row has a width.
 */
export function trackScrollEdges(row: HTMLElement, signal?: AbortSignal): void {
  row.addEventListener("scroll", () => syncScrollEdges(row), { passive: true, signal });
  if (signal) {
    window.addEventListener("resize", () => syncScrollEdges(row), { passive: true, signal });
  }
  requestFrame(() => syncScrollEdges(row));
}

/** Centre a link in its scrolling row without touching the page scroll. */
function revealLink(row: HTMLElement, link: HTMLElement): void {
  if (typeof row.scrollTo !== "function") {
    return;
  }
  const start = link.offsetLeft;
  if (start >= row.scrollLeft && start + link.offsetWidth <= row.scrollLeft + row.clientWidth) {
    return;
  }
  row.scrollTo({
    left: Math.max(0, start - (row.clientWidth - link.offsetWidth) / 2),
    behavior: "smooth",
  });
}

/**
 * Keep a jump row in step with the page: the link of the section under the sticky chrome carries
 * `aria-current`, and the row scrolls that link into view.
 *
 * The observer is only a trigger: the active section comes from one rect comparison against the
 * reading line, so it stays put until the next heading actually reaches the line instead of
 * flickering between two sections that both intersect. The returned `activate` lets a click mark
 * its target at once, before the scroll has settled.
 *
 * Resize and scroll events are coalesced into one animation frame. A resize only rebuilds the
 * observer when the band (viewport minus reading line) changed, and `activate` writes
 * `aria-current` on at most the previous and the new link.
 */
export function trackJumpRow(
  { row, links, sections }: JumpRow,
  signal: AbortSignal,
): (index: number) => void {
  let current = -1;
  let observer: IntersectionObserver | null = null;
  let observerMargin = "";
  let edgesFrame: FrameHandle = null;
  let resizeFrame: FrameHandle = null;
  let bootOuter: FrameHandle = null;
  let bootInner: FrameHandle = null;

  const activate = (index: number): void => {
    if (index === current) {
      return;
    }
    const previous = current;
    current = index;
    // Only the two links whose state actually changed are touched; the rest of the row stays.
    if (previous >= 0) {
      links[previous]?.removeAttribute("aria-current");
    }
    const link = links[index];
    if (link) {
      link.setAttribute("aria-current", "true");
      revealLink(row, link);
      syncScrollEdges(row);
    }
  };

  const pick = (): number => {
    const viewport = window.innerHeight;
    const height = document.documentElement.scrollHeight;
    if (
      Number.isFinite(viewport) &&
      height > viewport + 4 &&
      window.scrollY + viewport >= height - 4
    ) {
      // A short last section may never reach the line; the end of the page is its own answer.
      return sections.length - 1;
    }
    const line = readingLine();
    let active = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= line) {
        active = index;
      }
    });
    return active;
  };

  const observerOptions = (): IntersectionObserverInit => {
    const height = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
    // A band from the top of the viewport down to the reading line: a section enters exactly when
    // its heading reaches the line and leaves once its last row has passed it.
    return {
      rootMargin: `0px 0px -${Math.max(0, height - readingLine())}px 0px`,
    };
  };

  const observe = (): void => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const options = observerOptions();
    const margin = options.rootMargin ?? "";
    if (observer !== null && margin === observerMargin) {
      // Same band: the existing observer already watches every section, so keep it.
      return;
    }
    observer?.disconnect();
    observerMargin = margin;
    observer = new IntersectionObserver(() => activate(pick()), options);
    for (const section of sections) {
      observer.observe(section);
    }
  };

  const syncEdges = (): void => {
    syncScrollEdges(row);
  };

  const scheduleEdges = (): void => {
    if (edgesFrame !== null) {
      return;
    }
    edgesFrame = requestFrame(() => {
      edgesFrame = null;
      syncEdges();
    });
  };

  const applyResize = (): void => {
    observe();
    activate(pick());
    syncEdges();
  };

  const scheduleResize = (): void => {
    if (resizeFrame !== null) {
      return;
    }
    resizeFrame = requestFrame(() => {
      resizeFrame = null;
      applyResize();
    });
  };

  const release = (): void => {
    for (const frame of [edgesFrame, resizeFrame, bootOuter, bootInner]) {
      cancelFrame(frame);
    }
    edgesFrame = null;
    resizeFrame = null;
    bootOuter = null;
    bootInner = null;
    observer?.disconnect();
    observer = null;
  };

  activate(pick());
  row.addEventListener("scroll", scheduleEdges, { passive: true, signal });

  // The sticky chrome publishes its height in an animation frame after the render; observing a
  // frame later keeps the reading line on the same line as `scroll-margin-top`.
  bootOuter = requestFrame(() => {
    bootOuter = null;
    bootInner = requestFrame(() => {
      bootInner = null;
      syncEdges();
      observe();
    });
  });

  window.addEventListener("resize", scheduleResize, { passive: true, signal });
  signal.addEventListener("abort", release, { once: true });

  return activate;
}
