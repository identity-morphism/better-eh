/** Breathing room between the pinned chrome and the first line of content. */
const READING_GAP = 12;

/**
 * Publish the height of the sticky chrome as CSS variables.
 *
 * `.topbar`, the settings jump row and the toplist tab strip all pin to the top of the viewport.
 * Anything that scrolls under them — section headings reached by a jump link, `:target` anchors —
 * needs to know how much space they occupy, and the height changes with the row wrapping, the
 * viewport and the zoom. Measuring once per render and on resize keeps the CSS honest.
 *
 * - `--topbar-h`: height of the sticky header, so the next sticky row can sit under it.
 * - `--sticky-reading-line`: the whole pinned stack plus breathing room. `scroll-margin-top` and the
 *   jump row's "current section" test both read it, so the two cannot drift apart.
 */
export function trackStickyChrome(root: HTMLElement): () => void {
  let frame = 0;

  const apply = (): void => {
    frame = 0;
    const style = document.documentElement.style;
    const header = root.querySelector<HTMLElement>(".topbar");
    const pinned = [
      ...root.querySelectorAll<HTMLElement>(".topbar, .settings-jump, .toplist-tabs"),
    ];

    let stack = 0;
    for (const node of pinned) {
      stack += Math.round(node.getBoundingClientRect().height);
    }
    style.setProperty(
      "--topbar-h",
      `${header === null ? 0 : Math.round(header.getBoundingClientRect().height)}px`,
    );
    style.setProperty("--sticky-reading-line", `${stack + READING_GAP}px`);
  };

  const schedule = (): void => {
    if (frame === 0) {
      frame = requestAnimationFrame(apply);
    }
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  for (const node of root.querySelectorAll(".topbar, .settings-jump, .toplist-tabs")) {
    observer.observe(node);
  }
  window.addEventListener("resize", schedule, { passive: true });
  schedule();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    if (frame !== 0) {
      cancelAnimationFrame(frame);
    }
    const style = document.documentElement.style;
    style.removeProperty("--topbar-h");
    style.removeProperty("--sticky-reading-line");
  };
}
