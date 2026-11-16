import { infiniteScroll } from "./infinite-scroll";
import type { CursorPage, PageCursorState } from "./page-cursor";

/** One rendered page and whatever renderer-owned state travels with it. */
interface ContinuousStackPage<View> {
  readonly node: HTMLElement;
  readonly view: View;
}

interface ContinuousStackOptions<T, View> {
  /** The reader's continuous container; the stack fills it with pages and one sentinel. */
  container: HTMLElement;
  /** The page already on screen; the stack renders it and follows its next URL. */
  initial: T;
  /** URL after the initial page, or null when it is the last one. */
  next: string | null;
  key: (item: T) => string;
  load: (url: string, signal: AbortSignal) => Promise<CursorPage<T>>;
  /** Build one page; the returned view is kept with it for the view's surface and counter. */
  render: (item: T) => { node: HTMLElement; view: View };
  /** Called after an append, a failure, or the end so the view can re-sync its own chrome. */
  onChange?: () => void;
  /** View lifetime; aborts observation and in-flight loads. */
  signal: AbortSignal;
}

export interface ContinuousStack<View> {
  /** Pages in display order. */
  pages: () => readonly ContinuousStackPage<View>[];
  /** The page cursor's current loading/done/failed/looped state. */
  state: () => PageCursorState;
  /** Fetch the next page now; true when at least one page was appended. */
  loadNext: () => Promise<boolean>;
  /** Clear a failed fetch and retry the same page; true when at least one page was appended. */
  retry: () => Promise<boolean>;
  /** Stop observing, fetching and listening. Safe to call more than once. */
  stop: () => void;
}

/**
 * The reader's vertical stack: initial page plus an infinite-scroll sentinel that appends the rest.
 *
 * The stack owns only the rendered page list. Fetching, dedupe, the chain cap and the status line
 * stay in {@link infiniteScroll}, so there is exactly one sentinel implementation in the app.
 */
export function createContinuousStack<T, View>({
  container,
  initial,
  next,
  key,
  load,
  render,
  onChange,
  signal,
}: ContinuousStackOptions<T, View>): ContinuousStack<View> {
  const pages: ContinuousStackPage<View>[] = [];
  const appendPage = (item: T): void => {
    const rendered = render(item);
    pages.push({ node: rendered.node, view: rendered.view });
    container.insertBefore(rendered.node, scroll.element);
  };

  const scroll = infiniteScroll<T>({
    next,
    key,
    initialKeys: [key(initial)],
    load,
    noun: "pages",
    rootMargin: "150% 0px",
    signal,
    onChange,
    append: (items) => {
      for (const item of items) {
        appendPage(item);
      }
    },
  });
  scroll.element.classList.add("continuous-status", "reader-sentinel");

  container.replaceChildren(scroll.element);
  appendPage(initial);

  return {
    pages: () => pages,
    state: scroll.state,
    loadNext: scroll.loadNext,
    retry: scroll.retry,
    stop: scroll.stop,
  };
}
