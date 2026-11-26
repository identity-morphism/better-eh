/**
 * One gallery's favorite truth.
 *
 * A result card and the gallery header each paint the same gallery, so they read and write one
 * state instead of keeping copies of the parsed mark. A completed change outlives the view that
 * made it: the route cache can still hold the pre-mutation page, so the next state for that gallery
 * starts from the change rather than from the stale parse. Unknown (signed out, or a page without
 * the mark) is distinct from known-unfavorited: the menu's wording and the remove action depend on
 * that difference.
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

/** Recent completed changes, keyed by gallery id, so a cached page cannot undo them. */
const completed = new Map<string, FavoriteSnapshot>();
const COMPLETED_LIMIT = 200;

function remember(gid: string, snapshot: FavoriteSnapshot): void {
  completed.delete(gid);
  completed.set(gid, { ...snapshot });
  if (completed.size > COMPLETED_LIMIT) {
    const oldest = completed.keys().next().value;
    if (oldest !== undefined) {
      completed.delete(oldest);
    }
  }
}

/** Forget completed changes; tests isolate one gallery session from the next. */
export function resetFavoriteMarks(): void {
  completed.clear();
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
  const remembered = completed.get(gallery.gid);
  let snapshot: FavoriteSnapshot;
  if (remembered !== undefined) {
    snapshot = remembered;
  } else if (!known) {
    snapshot = { favorited: null, folder: null, slot: null };
  } else if (mark === null) {
    snapshot = { favorited: false, folder: null, slot: null };
  } else {
    snapshot = { favorited: true, folder: mark.folder, slot: mark.slot };
  }
  const listeners = new Set<(snapshot: FavoriteSnapshot) => void>();

  return {
    gid: gallery.gid,
    token: gallery.token,
    get: () => snapshot,
    set(favorited, folder) {
      snapshot = favorited
        ? { favorited: true, folder: folder?.name ?? "", slot: folder?.slot ?? null }
        : { favorited: false, folder: null, slot: null };
      remember(gallery.gid, snapshot);
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
