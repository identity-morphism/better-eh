import { warn } from "../log";
import { priorityOf } from "../net/priority";
import type { PageData } from "../types";
import { isAbortError, RateLimitedError } from "./errors";
import type { RetryWithNlOptions, ViewerPageOptions } from "./loader";

/** Navigation bursts are common; only the page the reader settles on is worth warming. */
export const PREFETCH_IDLE_MS = 150;

/** The part of a preloaded image the warmer needs: one error listener. */
export interface PreloadedImage {
  addEventListener(type: "error", listener: () => void, options?: { once?: boolean }): void;
}

/** A timer source; tests inject a fake so the idle debounce is deterministic. */
export interface PrefetcherClock {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

/** Everything one prefetcher needs from the page loader, image cache, queue, settings and clock. */
interface PrefetcherDeps {
  /** Fetch and parse one viewer page, sharing the loader's in-flight request with the reader. */
  viewerPage: (url: string, options: ViewerPageOptions) => Promise<PageData>;
  preloadImage: (src: string) => PreloadedImage;
  touchImage: (src: string) => void;
  retryWithNl: (page: PageData, options?: RetryWithNlOptions) => Promise<PageData | null>;
  /** Requests currently on the wire, excluding queued work. */
  activeCount: () => number;
  /** The queue's configured concurrency. */
  concurrency: () => number;
  /** How many pages to warm in each direction. */
  depth: () => number;
  /** True when the connection asks for reduced data; warming is skipped entirely. */
  saveData?: () => boolean;
  /** Timer source, so the idle debounce is controlled by the caller and tests. */
  clock: PrefetcherClock;
}

/** One independent warmed window; the viewer owns one per mount. */
export interface Prefetcher {
  /** Replace the current window with `data`'s neighbours, nearest first, after the idle delay. */
  warm(data: PageData): void;
  /** Stop warming further pages; orphaned requests abort, joined navigations finish. */
  cancel(): void;
}

/**
 * Build one prefetch window owner.
 *
 * Every piece of mutable scheduling state lives in this closure, so two prefetchers can run side by
 * side without cancelling or debouncing each other.
 */
export function createPrefetcher(deps: PrefetcherDeps): Prefetcher {
  const clock = deps.clock;
  let generation = 0;
  let timer: number | undefined;
  let inflight: AbortController | null = null;
  /** One request at a time, so a warm can never occupy more than one queue slot. */
  let chain: Promise<void> = Promise.resolve();

  function stop(): void {
    generation += 1;
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
    // A prefetch that nobody joined is cancelled outright; a navigation that shares the request
    // protects it (see `cancel` in the loader).
    inflight?.abort();
    inflight = null;
  }

  /** Serialise prefetch requests, so the two directions cannot fill every queue slot. */
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Fetch one warmed page, leaving at least one free queue slot for the reader.
   *
   * The capacity check is deliberately conservative: when the only free slot would be taken, the
   * walk stops instead of queueing. The next mount starts a fresh window, so nothing is lost.
   */
  async function warmPage(
    href: string,
    mine: number,
    signal: AbortSignal,
  ): Promise<PageData | null> {
    return exclusive(async () => {
      if (generation !== mine) {
        return null;
      }
      if (deps.activeCount() >= deps.concurrency() - 1) {
        return null;
      }
      try {
        return await deps.viewerPage(href, {
          priority: priorityOf("prefetch"),
          tag: "prefetch",
          signal,
          cancel: true,
        });
      } catch (error) {
        if (error instanceof RateLimitedError) {
          // The site is throttling us: stop both directions now instead of finishing the depth.
          stop();
          return null;
        }
        if (!isAbortError(error)) {
          warn("prefetch page failed", href, error);
        }
        return null;
      }
    });
  }

  /** Warm one page's image and let a failed image trigger a single no-limit retry. */
  function preloadPageImage(page: PageData, mine: number, signal: AbortSignal): void {
    const img = deps.preloadImage(page.imgSrc);
    img.addEventListener(
      "error",
      () => {
        if (generation !== mine || signal.aborted) {
          return;
        }
        void deps
          .retryWithNl(page, { signal, priority: priorityOf("prefetch") })
          .then((retried) => {
            if (retried !== null && retried.imgSrc !== "" && generation === mine) {
              deps.preloadImage(retried.imgSrc);
            }
          });
      },
      { once: true },
    );
  }

  async function warmOneWay(
    start: PageData,
    step: (page: PageData) => string | null,
    mine: number,
    signal: AbortSignal,
    depth: number,
  ): Promise<string[]> {
    const images: string[] = [];
    let page = start;
    for (let index = 0; index < depth; index++) {
      if (generation !== mine) {
        break;
      }
      const href = step(page);
      if (href === null) {
        break;
      }
      const next = await warmPage(href, mine, signal);
      if (next === null || generation !== mine) {
        break;
      }
      if (next.imgSrc) {
        preloadPageImage(next, mine, signal);
        images.push(next.imgSrc);
      }
      page = next;
    }
    return images;
  }

  /**
   * Re-touch warmed images far-to-near, so a small image cache keeps the pages the reader is about
   * to reach rather than the deepest ones.
   */
  function touchWarmed(forward: string[], backward: string[]): void {
    const deepest = Math.max(forward.length, backward.length) - 1;
    for (let index = deepest; index >= 0; index--) {
      const behind = backward[index];
      if (behind !== undefined) {
        deps.touchImage(behind);
      }
      const ahead = forward[index];
      if (ahead !== undefined) {
        deps.touchImage(ahead);
      }
    }
  }

  function warm(data: PageData): void {
    stop();
    if (deps.saveData?.() === true) {
      return;
    }
    const depth = deps.depth();
    if (depth < 1) {
      return;
    }
    const mine = generation;
    const signal = new AbortController();
    inflight = signal;

    timer = clock.setTimeout(() => {
      timer = undefined;
      if (generation !== mine) {
        return;
      }
      void (async () => {
        const [forward, backward] = await Promise.all([
          warmOneWay(data, (page) => page.nextHref, mine, signal.signal, depth),
          warmOneWay(data, (page) => page.prevHref, mine, signal.signal, depth),
        ]);
        if (generation === mine) {
          touchWarmed(forward, backward);
        }
      })().catch((error: unknown) => {
        warn("prefetch error", error);
      });
    }, PREFETCH_IDLE_MS);
  }

  return { warm, cancel: stop };
}
