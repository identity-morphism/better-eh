/** How long a history restore keeps retrying while lazy content grows the document. */
const SCROLL_RESTORE_TIMEOUT_MS = 8000;

/** How long the document may stop growing before the restore gives up. */
const SCROLL_RESTORE_STALL_MS = 3000;

/** How often the restore measures and scrolls; doing it every frame forces a layout each frame. */
const SCROLL_RESTORE_SAMPLE_MS = 100;

/** Every dependency defaults to the browser; a caller (or a test fake) supplies only overrides. */
export interface ScrollRestoreDeps {
  scrollTo?: (y: number) => void;
  scrollY?: () => number;
  scrollHeight?: () => number;
  now?: () => number;
  frame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  timeoutMs?: number;
  /** Spacing between layout samples; the loop still yields once per frame. */
  sampleMs?: number;
  /** Ask the mounted endless-scroll region for one more page. */
  advance?: () => Promise<boolean>;
  /** Called once when the restore finishes on its own; a caller stop does not call it. */
  onDone?: () => void;
}

/**
 * Scroll to a saved history position while appended pages grow the document.
 *
 * Paged views can restore in one sample, but an infinite-scroll view renders only its first page
 * first: the saved target clamps to the current bottom, and the next pages arrive after the mount.
 * Re-apply the target on a slow clock until it is reachable (within two pixels) or the deadline
 * passes, so the restore does not force a layout every frame. The caller stops the returned
 * function on unmount or user input, and `onDone` lets it drop those listeners when the restore
 * finishes by itself.
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
    sampleMs = SCROLL_RESTORE_SAMPLE_MS,
    advance = () => Promise.resolve(false),
    onDone = () => undefined,
  }: ScrollRestoreDeps = {},
): () => void {
  let finished = false;
  let pending: number | null = null;
  let stopped = false;

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

  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    stop();
    onDone();
  };

  if (target <= 0) {
    scrollTo(0);
    finish();
    return stop;
  }

  const deadline = now() + timeoutMs;
  let growing = false;
  let advanceExhausted = false;
  let lastHeight = scrollHeight();
  let lastGrowth = now();
  let lastSample = now() - sampleMs;

  const tick = (): void => {
    pending = null;
    if (stopped) {
      return;
    }

    const at = now();
    if (at - lastSample < sampleMs) {
      pending = frame(tick);
      return;
    }
    lastSample = at;

    const height = scrollHeight();
    const changed = height !== lastHeight;
    const reachedBefore = Math.abs(scrollY() - target) <= 2;
    // Scroll only when the document changed (the saved target may now fit) or the last attempt
    // could not reach it; an unchanged document that is already there ends below without a write.
    if (changed || !reachedBefore) {
      scrollTo(target);
    }
    if (changed) {
      lastHeight = height;
      lastGrowth = at;
    }
    const reached = Math.abs(scrollY() - target) <= 2;
    // Lazy pages can take a while; only stop early once the document has stopped growing, rather
    // than pinning the page to its clamped bottom for the full eight seconds.
    const stalled = at - lastGrowth >= SCROLL_RESTORE_STALL_MS;
    if (reached || stalled || at >= deadline) {
      finish();
      return;
    }
    // The region stops chaining after a few pages to keep one scroll gesture cheap; a restore is
    // not a gesture, so ask for the next page itself rather than waiting for a sentinel that is
    // disarmed at the cap. A refusal is final: the region has nothing more to append.
    if (!growing && !advanceExhausted) {
      growing = true;
      void advance()
        .then((more) => {
          if (!more) {
            advanceExhausted = true;
          }
        })
        .catch(() => {
          advanceExhausted = true;
        })
        .finally(() => {
          growing = false;
        });
    }
    pending = frame(tick);
  };

  pending = frame(tick);
  return stop;
}
