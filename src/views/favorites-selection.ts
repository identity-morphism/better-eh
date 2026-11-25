import type { Unsubscribe } from "../emitter";
import { createEmitter } from "../emitter";

/** Bulk-selection state for the favorites grid: chosen gids, range anchor and select-all. */

/** Modifiers reported by one card checkbox change. */
interface ToggleOptions {
  /** Extend from the anchor to this card instead of toggling the card alone. */
  shift?: boolean;
}

/**
 * One favorites page's selected gids.
 *
 * `ids()` and the `all`/`some` flags derive from the page's source order, so the view never keeps a
 * second copy or reconciles with the rendered checkboxes. Mutations notify subscribers once each,
 * after state has settled.
 */
export interface FavoritesSelection {
  /** Whether `gid` is selected. */
  has(gid: string): boolean;
  /** Number of selected gids. */
  readonly size: number;
  /** Whether every gid on the page is selected; false when the page has none. */
  readonly all: boolean;
  /** Whether at least one gid on the page is selected. */
  readonly some: boolean;
  /** Selected gids in source order. */
  ids(): string[];
  /** Toggle one card; a shift toggle extends the selection from the last anchor instead. */
  toggle(gid: string, options?: ToggleOptions): void;
  /** Select or clear every gid on the page, resetting the anchor. */
  setAll(on: boolean): void;
  /** Clear the selection and the anchor. */
  clear(): void;
  /** Observe mutations; returns the unsubscribe function. */
  subscribe(listener: () => void): Unsubscribe;
}

/** Create the selection for one page's gids, kept in the order they were rendered. */
export function createSelection(gids: readonly string[]): FavoritesSelection {
  const order = [...gids];
  const positions = new Map(order.map((gid, index) => [gid, index]));
  const chosen = new Set<string>();
  const selectionChanged = createEmitter<void>();
  let anchor: number | null = null;

  const notify = (): void => {
    selectionChanged.emit();
  };

  return {
    has(gid) {
      return chosen.has(gid);
    },
    get size() {
      return chosen.size;
    },
    get all() {
      return order.length > 0 && chosen.size === order.length;
    },
    get some() {
      return chosen.size > 0;
    },
    ids() {
      return order.filter((gid) => chosen.has(gid));
    },
    toggle(gid, options = {}) {
      const index = positions.get(gid);
      if (index === undefined) {
        return;
      }

      if (options.shift && anchor !== null) {
        const target = index;
        const from = Math.min(anchor, target);
        const to = Math.max(anchor, target);
        for (let cursor = from; cursor <= to; cursor += 1) {
          const entry = order[cursor];
          if (entry !== undefined) {
            chosen.add(entry);
          }
        }
        anchor = target;
        notify();
        return;
      }

      if (chosen.has(gid)) {
        chosen.delete(gid);
      } else {
        chosen.add(gid);
      }
      anchor = index;
      notify();
    },
    setAll(on) {
      let changed = anchor !== null;
      if (on) {
        for (const gid of order) {
          if (!chosen.has(gid)) {
            chosen.add(gid);
            changed = true;
          }
        }
      } else {
        changed = chosen.size > 0 || anchor !== null;
        chosen.clear();
      }
      anchor = null;
      if (changed) {
        notify();
      }
    },
    clear() {
      const changed = chosen.size > 0 || anchor !== null;
      chosen.clear();
      anchor = null;
      if (changed) {
        notify();
      }
    },
    subscribe(listener) {
      return selectionChanged.subscribe(listener);
    },
  };
}
