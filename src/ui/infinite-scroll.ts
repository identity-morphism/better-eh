import { el } from "./dom";
import type { CursorPage, PageCursorState } from "./page-cursor";
import { createPageCursor } from "./page-cursor";

/** How far ahead of the viewport the next page is requested, in CSS pixels. */
const DEFAULT_ROOT_MARGIN = "800px 0px";

/** Pages one scroll gesture may chain before the sentinel asks for a deliberate next step. */
const DEFAULT_MAX_CHAINED_PAGES = 3;

/** Options for the infinite-scroll sentinel. */
interface InfiniteScrollOptions<T> {
  /** URL of the page after the rendered one, or null when there is nothing more. */
  next: string | null;
  /** Stable identity of an item, so overlapping pages cannot append a card twice. */
  key: (item: T) => string;
  /** Keys already rendered by the initial page. */
  initialKeys?: readonly string[];
  load: (url: string, signal: AbortSignal) => Promise<CursorPage<T>>;
  /** Append one page's fresh items to the view. */
  append: (items: readonly T[]) => void;
  /** Plural subject for the failure line, e.g. "galleries". */
  noun: string;
  /** How far ahead of the viewport to fetch, in IntersectionObserver rootMargin syntax. */
  rootMargin?: string;
  /** Pages one scroll gesture may chain before showing Load more. */
  maxChainedPages?: number;
  /** Called after an append, a failure, or the end so the view can re-sync its own chrome. */
  onChange?: () => void;
  /** View lifetime; aborts observation and in-flight loads. */
  signal: AbortSignal;
}

export interface InfiniteScrollHandle {
  /** Sentinel to place after the content; hidden when the first page is also the last. */
  element: HTMLElement;
  /** Fetch the next page now; resolves to whether at least one item was appended. */
  loadNext: () => Promise<boolean>;
  /** Clear a failed fetch and retry the same page; resolves like {@link loadNext}. */
  retry: () => Promise<boolean>;
  /** The page cursor's current loading/done/failed/looped state. */
  state: () => PageCursorState;
  /** Stop observing and abort any in-flight page. Safe to call more than once. */
  stop: () => void;
}

/**
 * Append the next pages of a paginated view as its sentinel approaches the viewport.
 *
 * The page cursor owns sequential fetching, deduplication, loop detection and retryable failure.
 * This module is the one sentinel implementation shared by the listing views and the reader's
 * continuous mode: it owns what the user sees, the status line, the retry button and the Load more
 * escape hatch. A single gesture stops after {@link InfiniteScrollOptions.maxChainedPages}; the
 * sentinel then offers “Load more”, so a jump to the end of a huge gallery cannot fetch every
 * remaining page in one burst. A failed request stops the chain until the user retries, which is
 * why the sentinel carries its own retry button instead of leaning on the view's error handling.
 */
export function infiniteScroll<T>({
  next,
  key,
  initialKeys = [],
  load,
  append,
  noun,
  rootMargin = DEFAULT_ROOT_MARGIN,
  maxChainedPages = DEFAULT_MAX_CHAINED_PAGES,
  onChange,
  signal,
}: InfiniteScrollOptions<T>): InfiniteScrollHandle {
  const status = el("p", { class: "infinite-status", role: "status" });
  const retryButton = el("button", {
    class: "btn btn-small infinite-retry",
    type: "button",
    text: "Retry",
  });
  retryButton.hidden = true;
  const more = el("button", {
    class: "btn btn-small infinite-more",
    type: "button",
    text: "Load more",
  });
  more.hidden = true;
  const element = el("div", { class: "infinite-scroll" }, status, more, retryButton);
  element.hidden = next === null;

  // The cursor owns fetching and dedupe; the sentinel owns its DOM lifetime. Stopping from the view
  // (or the view signal firing) must cancel both.
  const cursor = createPageCursor<T>({ next, key, initialKeys, load, signal });
  const listeners = new AbortController();
  let armed = true;
  let chained = 0;
  let stopped = false;
  // A stop can happen while a load is in flight; read through a call so the check is not narrowed
  // to the value it had before the await.
  const isStopped = (): boolean => stopped;

  const observer = new IntersectionObserver(
    (entries) => {
      if (armed && entries.some((entry) => entry.isIntersecting)) {
        void fetchNext();
      }
    },
    { rootMargin },
  );

  const finish = (text: string): void => {
    armed = false;
    more.hidden = true;
    status.textContent = text;
    observer.disconnect();
  };

  const fail = (): void => {
    armed = false;
    more.hidden = true;
    status.textContent = `Could not load more ${noun}.`;
    retryButton.hidden = false;
    observer.disconnect();
  };

  async function fetchNext(): Promise<boolean> {
    const before = cursor.state();
    if (!armed || stopped || before.loading || before.done || before.failed) {
      return false;
    }
    status.textContent = `Loading more ${noun}…`;

    const fresh = await cursor.loadNext();
    const after = cursor.state();
    if (isStopped()) {
      return false;
    }
    if (after.failed) {
      fail();
      onChange?.();
      return false;
    }
    if (fresh === null) {
      if (after.done) {
        finish(after.looped ? "No more pages." : "");
        onChange?.();
      }
      return false;
    }
    const appended = fresh.length > 0;
    if (appended) {
      append(fresh);
    }
    if (after.done) {
      finish(after.looped ? "No more pages." : "");
      onChange?.();
      return appended;
    }

    chained += 1;
    if (chained >= maxChainedPages) {
      // The reader is at the bottom of a long document: hand the next step to a deliberate
      // gesture instead of fetching the whole remaining gallery in one scroll event.
      armed = false;
      status.textContent = "";
      more.hidden = false;
      observer.disconnect();
      onChange?.();
      return appended;
    }

    // IntersectionObserver only reports changes: after appending, re-observe so a sentinel still
    // inside the margin (a short page) fetches the page after it. A capped run stays disarmed until
    // the user scrolls again or presses Load more.
    status.textContent = "";
    observer.unobserve(element);
    observer.observe(element);
    onChange?.();
    return appended;
  }

  const loadNext = (): Promise<boolean> => {
    if (stopped || cursor.state().failed) {
      return Promise.resolve(false);
    }
    armed = true;
    chained = 0;
    more.hidden = true;
    return fetchNext();
  };

  const retry = (): Promise<boolean> => {
    if (stopped || cursor.state().loading) {
      return Promise.resolve(false);
    }
    cursor.retry();
    armed = true;
    chained = 0;
    retryButton.hidden = true;
    more.hidden = true;
    status.textContent = "";
    return fetchNext();
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    cursor.stop();
    listeners.abort();
    observer.disconnect();
    signal.removeEventListener("abort", stop);
  };

  if (signal.aborted) {
    stop();
  } else {
    signal.addEventListener("abort", stop, { once: true });
  }

  retryButton.addEventListener("click", () => void retry(), { signal: listeners.signal });
  more.addEventListener("click", () => void loadNext(), { signal: listeners.signal });

  if (next === null || signal.aborted) {
    observer.disconnect();
  } else {
    observer.observe(element);
  }

  return {
    element,
    loadNext,
    retry,
    state: () => cursor.state(),
    stop,
  };
}
