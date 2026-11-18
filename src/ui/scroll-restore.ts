/** How long a history restore keeps retrying while lazy content grows the document. */
const SCROLL_RESTORE_TIMEOUT_MS = 8000;

/** How long the document may stop growing before the restore gives up. */
const SCROLL_RESTORE_STALL_MS = 3000;

/** Every dependency defaults to the browser; a caller (or a test fake) supplies only overrides. */
export interface ScrollRestoreDeps {
  scrollTo?: (y: number) => void;
  scrollY?: () => number;
  scrollHeight?: () => number;
  now?: () => number;
  frame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  timeoutMs?: number;
  /** Ask the mounted endless-scroll region for one more page. */
  advance?: () => Promise<boolean>;
}

/**
 * Scroll to a saved history position while appended pages grow the document.
 *
 * Paged views can restore in one frame, but an infinite-scroll view renders only its first page
 * first: the saved target clamps to the current bottom, and the next pages arrive after the mount.
 * Re-apply the target on each frame until it is reachable (within two pixels) or the deadline
 * passes. The caller stops the returned function on unmount or user input, so the restore never
 * fights a deliberate scroll.
 */
export function restoreScrollWhenReady(
  target: number,
  {
    scrollTo = (y: number) => {
      window.scrollTo(0, y);
    },
    scrollY = () => window.scrollY,
    scrollHeight = () => document.documentElement.scrollHeight,
    now = () => performance.now(),
    frame = (callback: () => void) => window.requestAnimationFrame(callback),
    cancelFrame = (handle: number) => window.cancelAnimationFrame(handle),
    timeoutMs = SCROLL_RESTORE_TIMEOUT_MS,
    advance = () => Promise.resolve(false),
  }: ScrollRestoreDeps = {},
): () => void {
  if (target <= 0) {
    scrollTo(0);
    return () => undefined;
  }

  const deadline = now() + timeoutMs;
  let pending: number | null = null;
  let stopped = false;
  let growing = false;
  let lastHeight = scrollHeight();
  let lastGrowth = now();

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (pending !== null) {
      cancelFrame(pending);
      pending = null;
    }
  };

  const tick = (): void => {
    pending = null;
    if (stopped) {
      return;
    }

    scrollTo(target);
    const at = now();
    const height = scrollHeight();
    if (height !== lastHeight) {
      lastHeight = height;
      lastGrowth = at;
    }
    const reached = Math.abs(scrollY() - target) <= 2;
    // Lazy pages can take a while; only stop early once the document has stopped growing, rather
    // than pinning the page to its clamped bottom for the full eight seconds.
    const stalled = at - lastGrowth >= SCROLL_RESTORE_STALL_MS;
    if (reached || stalled || at >= deadline) {
      stopped = true;
      return;
    }
    // The region stops chaining after a few pages to keep one scroll gesture cheap; a restore is
    // not a gesture, so ask for the next page itself rather than waiting for a sentinel that is
    // disarmed at the cap.
    if (!growing) {
      growing = true;
      void advance()
        .catch(() => false)
        .finally(() => {
          growing = false;
        });
    }
    pending = frame(tick);
  };

  pending = frame(tick);
  return stop;
}
