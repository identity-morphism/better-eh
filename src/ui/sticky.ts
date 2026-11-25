import type { FrameHandle } from "./frame";
import { cancelFrame, requestFrame } from "./frame";

/** Breathing room between the pinned chrome and the first line of content. */
const READING_GAP = 12;

/** The rows that pin to the top of the viewport, in stacking order. */
const PINNED_SELECTOR = ".topbar, .settings-jump, .toplist-tabs";

/**
 * Publish the height of the sticky chrome as CSS variables.
 *
 * `.topbar`, the settings jump row and the toplist tab strip all pin to the top of the viewport.
 * Anything that scrolls under them — section headings reached by a jump link, `:target` anchors —
 * needs to know how much space they occupy, and the height changes with the row wrapping, the
 * viewport and the zoom. Measuring once per render and on resize keeps the CSS honest.
 *
 * Only the pinned rows are observed: a feed append or an image reflow elsewhere in the host does
 * not change their height, so it must not cost a measurement pass. The node lists are resolved
 * once, at mount, and resizing is the only other trigger.
 *
 * - `--topbar-h`: height of the sticky header, so the next sticky row can sit under it.
 * - `--sticky-reading-line`: the whole pinned stack plus breathing room. `scroll-margin-top` and the
 *   jump row's "current section" test both read it, so the two cannot drift apart.
 */
export function trackStickyChrome(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>(".topbar");
  const pinned = [...root.querySelectorAll<HTMLElement>(PINNED_SELECTOR)];
  let frame: FrameHandle = null;

  const apply = (): void => {
    frame = null;
    const headerHeight = header === null ? 0 : Math.round(header.getBoundingClientRect().height);

    let stack = 0;
    for (const node of pinned) {
      // The header is one of the pinned rows; reuse its measurement instead of reading it twice.
      stack += node === header ? headerHeight : Math.round(node.getBoundingClientRect().height);
    }

    const style = document.documentElement.style;
    style.setProperty("--topbar-h", `${headerHeight}px`);
    style.setProperty("--sticky-reading-line", `${stack + READING_GAP}px`);
  };

  const schedule = (): void => {
    frame ??= requestFrame(apply);
  };

  const observer = new ResizeObserver(schedule);
  const observed = new Set(pinned);
  if (header !== null) {
    observed.add(header);
  }
  for (const node of observed) {
    observer.observe(node);
  }
  window.addEventListener("resize", schedule, { passive: true });
  schedule();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    cancelFrame(frame);
    frame = null;
    const style = document.documentElement.style;
    style.removeProperty("--topbar-h");
    style.removeProperty("--sticky-reading-line");
  };
}
