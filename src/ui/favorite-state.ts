/**
 * One gallery's favorite truth.
 *
 * A result card and the gallery header each paint the same gallery, so they read and write one
 * state instead of keeping copies of the parsed mark. Unknown (signed out, or a page without the
 * mark) is distinct from known-unfavorited: the menu's wording and the remove action depend on that
 * difference.
 */

import type { FavoriteFolder } from "../data/favorites";
import type { FavoriteMark } from "../types";

export interface FavoriteSnapshot {
  /** Null while unknown; false once the page or a completed mutation knows it is not favorited. */
  favorited: boolean | null;
  /** Folder name while favorited, or null. */
  folder: string | null;
  /** Folder slot while favorited, or null when the mark carries no known slot. */
  slot: number | null;
}

export interface FavoriteState {
  readonly gid: string;
  readonly token: string;
  /** The current truth; never a copy that a caller can mutate. */
  get(): FavoriteSnapshot;
  /** Record a completed change; `folder` is null when the gallery was removed. */
  set(favorited: boolean, folder: FavoriteFolder | null): void;
  /** Observe changes; returns the unsubscribe function. */
  subscribe(listener: (snapshot: FavoriteSnapshot) => void): () => void;
}

/**
 * Create one gallery's state from its parsed mark.
 *
 * `known` is the page's authority on the mark: signed out, a parsed mark cannot prove the current
 * account's state, so the state stays unknown. When known, a mark means favorited, and no mark
 * means known-unfavorited.
 */
export function createFavoriteState(
  gallery: { gid: string; token: string },
  mark: FavoriteMark | null,
  known = mark !== null,
): FavoriteState {
  let snapshot: FavoriteSnapshot = !known
    ? { favorited: null, folder: null, slot: null }
    : mark === null
      ? { favorited: false, folder: null, slot: null }
      : { favorited: true, folder: mark.folder, slot: mark.slot };
  const listeners = new Set<(snapshot: FavoriteSnapshot) => void>();

  return {
    gid: gallery.gid,
    token: gallery.token,
    get: () => snapshot,
    set(favorited, folder) {
      snapshot = favorited
        ? { favorited: true, folder: folder?.name ?? "", slot: folder?.slot ?? null }
        : { favorited: false, folder: null, slot: null };
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
