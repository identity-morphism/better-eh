import { getSettings, onSettingsChange } from "../settings";
import type { UserSettings } from "../types";
import type { InfiniteScrollHandle } from "./infinite-scroll";
import { infiniteScroll } from "./infinite-scroll";
import type { CursorPage } from "./page-cursor";

interface PagedRegionOptions<T> {
  signal: AbortSignal;
  next: string | null;
  initial: readonly T[];
  key: (item: T) => string;
  noun: string;
  /** Whether this view's setting enables infinite scroll. */
  enabled: (settings: Readonly<UserSettings>) => boolean;
  /** Container that holds the pager, and the sentinel when it belongs there. */
  slot: HTMLElement;
  /** Build the pager for the current mode; null leaves the slot empty. */
  pager: (withNext: boolean) => HTMLElement | null;
  load: (url: string, signal: AbortSignal) => Promise<CursorPage<T>>;
  /** Render appended items in place; return how to undo that append. */
  append: (items: readonly T[]) => () => void;
  /** Put the sentinel where this view wants it (list: slot; gallery: after the grid). */
  placeSentinel: (node: HTMLElement) => void;
  /** After a mode switch or appended page, e.g. re-sync a "N of M" label. */
  onSync?: () => void;
}

/**
 * One pagination controller for the listing views.
 *
 * The pager and the infinite sentinel are two modes of the same region: the setting picks one, and
 * a switch tears the other down before building its replacement. Appended items are owned through
 * the undo callback each append returns, so leaving infinite mode removes exactly what it added.
 * The initial mode is drawn immediately, so the view never paints a pager the controller then
 * replaces.
 */
export function createPagedRegion<T>({
  signal,
  next,
  initial,
  key,
  noun,
  enabled,
  slot,
  pager,
  load,
  append,
  placeSentinel,
  onSync,
}: PagedRegionOptions<T>): void {
  const fillSlot = (node: HTMLElement | null): void => {
    slot.replaceChildren(...(node === null ? [] : [node]));
  };
  const undo: Array<() => void> = [];
  let scroll: InfiniteScrollHandle | null = null;
  let infinite: boolean | null = null;
  let stopped = false;

  const setMode = (on: boolean): void => {
    if (stopped || on === infinite) {
      return;
    }
    scroll?.stop();
    scroll?.element.remove();
    scroll = null;
    for (const revert of undo.splice(0).reverse()) {
      revert();
    }
    infinite = on;

    if (!on) {
      fillSlot(pager(true));
      onSync?.();
      return;
    }

    fillSlot(pager(false));
    scroll = infiniteScroll<T>({
      next,
      key,
      initialKeys: initial.map(key),
      noun,
      signal,
      load,
      append: (items) => {
        undo.push(append(items));
        onSync?.();
      },
    });
    placeSentinel(scroll.element);
    onSync?.();
  };

  const off = onSettingsChange((settings) => setMode(enabled(settings)));
  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    off();
    signal.removeEventListener("abort", stop);
    scroll?.stop();
    scroll?.element.remove();
    scroll = null;
  };

  if (signal.aborted) {
    stop();
  } else {
    signal.addEventListener("abort", stop, { once: true });
    setMode(enabled(getSettings()));
  }
}
