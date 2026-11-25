/** One fetched page and the cursor that follows it. */
export interface CursorPage<T> {
  items: readonly T[];
  /** URL of the page after this one, or null at the end. */
  next: string | null;
}

/**
 * Load and parse one appended page, sharing the route's own document loader and parser.
 *
 * The route table builds this from page one's document loader and parse function, so a change to
 * either is made once. Tests inject a fake where the view accepts one.
 */
export type PageSource<T> = (url: string, signal: AbortSignal) => Promise<CursorPage<T>>;

/** Inputs shared by the sequential cursor and every sentinel that drives it. */
export interface PageFeedOptions<T> {
  /** URL of the page after the rendered one, or null when there is nothing more. */
  next: string | null;
  /** Stable identity of an item, so overlapping pages cannot render one twice. */
  key: (item: T) => string;
  /** Keys already rendered before the feed started. */
  initialKeys?: readonly string[];
  /** Fetch one page; the signal aborts with the view. */
  load: (url: string, signal: AbortSignal) => Promise<CursorPage<T>>;
  /** View lifetime; aborting stops the in-flight request and every later load. */
  signal: AbortSignal;
}

/** Inputs for one cursor: the feed contract only. */
type PageCursorOptions<T> = PageFeedOptions<T>;

/**
 * Sequential next-page loader shared by the listing sentinel and the viewer's continuous mode.
 *
 * The cursor owns the parts a view should not reimplement: one request at a time, a seen-key set
 * that hides overlap between pages, visited-URL loop detection, and a failure state the view can
 * retry without rebuilding the cursor.
 */
export interface PageCursorState {
  /** Whether a request is in flight. */
  readonly loading: boolean;
  /** Whether the cursor reached the end, either a null next URL or a detected loop. */
  readonly done: boolean;
  /** Whether the last load threw; clear it with retry(). */
  readonly failed: boolean;
  /** Whether the cursor closed because a page pointed at itself or an already-fetched URL. */
  readonly looped: boolean;
}

interface PageCursor<T> {
  /**
   * Fetch the next page and resolve with its fresh items, or null when nothing was fetched (done,
   * failed, stopped, or a concurrent call already owns the request). Concurrent calls join the
   * in-flight request.
   */
  loadNext(): Promise<readonly T[] | null>;
  /**
   * The cursor's current state.
   *
   * A method, not properties: a load mutates the state asynchronously, so callers must read it
   * after every await rather than let TypeScript narrow a property across one.
   */
  state(): PageCursorState;
  /** Clear failed so the same page can be requested again. Does nothing once stopped. */
  retry(): void;
  /** Abort the in-flight request and refuse further loads. Safe to call more than once. */
  stop(): void;
}

/** Create the cursor for one view lifetime; pair every cursor with stop(). */
export function createPageCursor<T>({
  next,
  key,
  initialKeys = [],
  load,
  signal,
}: PageCursorOptions<T>): PageCursor<T> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

  const isAborted = (): boolean => controller.signal.aborted;
  const seen = new Set(initialKeys);
  const fetched = new Set<string>();
  let cursor = next;
  let loading = false;
  let done = next === null;
  let failed = false;
  let looped = false;
  let flight: Promise<readonly T[] | null> | null = null;

  const loadNext = (): Promise<readonly T[] | null> => {
    if (controller.signal.aborted || done || failed) {
      return Promise.resolve(null);
    }
    if (flight !== null) {
      return flight;
    }
    const url = cursor;
    if (url === null) {
      done = true;
      return Promise.resolve(null);
    }

    loading = true;
    let request: Promise<CursorPage<T>>;
    try {
      request = load(url, controller.signal);
    } catch {
      loading = false;
      if (!isAborted()) {
        failed = true;
      }
      return Promise.resolve(null);
    }

    // The callbacks run after this assignment, so a synchronously settling loader cannot clear the
    // shared flight before it is stored.
    const chain = request
      .then((page): readonly T[] | null => {
        if (controller.signal.aborted) {
          return null;
        }
        const fresh: T[] = [];
        for (const item of page.items) {
          const id = key(item);
          if (!seen.has(id)) {
            seen.add(id);
            fresh.push(item);
          }
        }
        fetched.add(url);
        cursor = page.next;
        if (cursor === null) {
          done = true;
        } else if (fetched.has(cursor)) {
          // A page that points back at itself (or at one already fetched) would loop forever.
          looped = true;
          done = true;
        }
        return fresh;
      })
      .catch(() => {
        if (!isAborted()) {
          failed = true;
        }
        return null;
      })
      .finally(() => {
        loading = false;
        flight = null;
      });
    flight = chain;
    return chain;
  };

  const retry = (): void => {
    if (!controller.signal.aborted) {
      failed = false;
    }
  };

  const stop = (): void => {
    controller.abort();
    signal.removeEventListener("abort", abort);
  };

  return {
    loadNext,
    state() {
      return { loading, done, failed, looped };
    },
    retry,
    stop,
  };
}
