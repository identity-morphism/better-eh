import { getFavoriteNote, getFolders, isLoggedIn, setFavorite } from "../data/favorites";
import type { FavoriteFolder } from "../data/favorites";
import { el, icon } from "./dom";
import { errorText } from "./error-text";
import type { FavoriteSnapshot, FavoriteState } from "./favorite-state";
import { announceInto } from "./live-region";
import { LOGIN_HREF } from "./login-gate";
import { bindPopover } from "./popover";
import { showToast } from "./toast";

export interface FavoriteMenuOptions {
  anchor: HTMLElement;
  /** The one state the button, the preview and the view repaint from. */
  state: FavoriteState;
  /** Folder source; tests pass a list without loading `/uconfig.php`. */
  loadFolders?: (signal?: AbortSignal) => Promise<FavoriteFolder[]>;
  /** Note source for an already-favorited gallery; tests pass a value without a request. */
  loadNote?: (signal?: AbortSignal) => Promise<string>;
  /** Favorite write; tests pass a recorder instead of posting to the site. */
  save?: (
    gallery: { gid: string; token: string },
    slot: number | null,
    note?: string,
  ) => Promise<void>;
}

let activeMenu: { close: () => void; anchor: HTMLElement } | null = null;

/** Close any open favorite menu (used when the underlying view is replaced). */
export function closeFavoriteMenu(): void {
  activeMenu?.close();
  activeMenu = null;
}

export interface StatusRegion {
  readonly node: HTMLElement;
  announce(text: string): void;
}

/**
 * The menu's one live region.
 *
 * A node inserted already carrying its text is ignored by assistive tech, so the region is created
 * once when the menu opens and later updates only its text. Mirrors `ui/toast`: a repeated message
 * is blanked for a frame first, or the identical node reads as unchanged.
 */
export function createStatusRegion(): StatusRegion {
  const node = el("div", {
    class: "fav-status",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  node.hidden = true;

  const write = (text: string): void => {
    node.textContent = text;
    node.hidden = text === "";
  };

  return {
    node,
    announce(text: string): void {
      announceInto(node, text.trim(), write);
    },
  };
}

function favoriteDot(color: string): HTMLElement {
  const dot = el("span", { class: "fav-dot" });
  dot.style.background = color;
  return dot;
}

/** Whether this folder is where the page says the gallery already sits. */
function isCurrentFavoriteFolder(folder: FavoriteFolder, snapshot: FavoriteSnapshot): boolean {
  if (snapshot.favorited !== true) {
    return false;
  }
  if (typeof snapshot.slot === "number") {
    return folder.slot === snapshot.slot;
  }
  const name = snapshot.folder?.trim();
  return name !== undefined && name !== "" && folder.name.toLowerCase() === name.toLowerCase();
}

/** Open the folder picker anchored to a favorite button. */
export function openFavoriteMenu(options: FavoriteMenuOptions): void {
  activeMenu?.close();

  const {
    anchor,
    state,
    loadFolders = getFolders,
    loadNote = (signal?: AbortSignal) => getFavoriteNote(state, signal),
    save = setFavorite,
  } = options;
  const content = el("div");
  const header = el("div", { class: "fav-head" });
  const syncHeader = (): void => {
    const favorited = state.get().favorited;
    header.textContent =
      favorited === true
        ? "Update favorite"
        : favorited === false
          ? "Add to favorites"
          : "Favorites";
  };
  syncHeader();
  const status = createStatusRegion();

  const note = el("textarea", {
    class: "field-input fav-note",
    rows: 2,
    placeholder: "Note (optional)",
    "aria-label": "Favorite note",
  });
  note.hidden = !isLoggedIn();
  const body = el("div", {}, header, status.node, note, content);
  const controller = new AbortController();

  const popover = bindPopover(
    anchor,
    () => ({
      content: body,
      dispose: () => {
        controller.abort();
        // One menu per anchor, and `openFavoriteMenu` closes the previous one first.
        if (activeMenu?.anchor === anchor) {
          activeMenu = null;
        }
      },
    }),
    {
      role: "dialog",
      label: "Favorite folders",
      className: "fav-menu",
      align: "end",
      autoFocus: true,
    },
  );

  activeMenu = { close: () => popover.close(), anchor };
  popover.open();

  const nativeFavoriteUrl = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(state.gid)}&t=${encodeURIComponent(state.token)}&act=addfav`;

  const nativeLink = (label: string): HTMLElement => {
    const link = el(
      "a",
      {
        class: "fav-link",
        href: nativeFavoriteUrl,
        "data-native": "",
        target: "_blank",
        rel: "noopener",
      },
      label,
    );
    return link;
  };

  const renderFolders = (folders: FavoriteFolder[]): void => {
    content.replaceChildren();

    if (!isLoggedIn()) {
      status.announce("Sign in to use favorites.");
      content.append(
        el(
          "a",
          {
            class: "fav-link",
            href: LOGIN_HREF,
            "data-native": "",
          },
          "Sign in",
        ),
      );
      return;
    }

    if (folders.length === 0) {
      status.announce("No favorite folders found.");
      content.append(nativeLink("Open native dialog"));
      return;
    }

    status.announce("");

    const snapshot = state.get();
    const grid = el("div", { class: "fav-grid" });
    for (const folder of folders) {
      const current = isCurrentFavoriteFolder(folder, snapshot);
      grid.append(
        el(
          "button",
          {
            class: current ? "fav-item is-current" : "fav-item",
            type: "button",
            "aria-current": current ? "true" : null,
            onclick: () => {
              void apply(folder);
            },
          },
          favoriteDot(folder.color),
          el("span", { class: "fav-name", text: folder.name }),
          current ? el("span", { class: "fav-check", "aria-hidden": "true", text: "✓" }) : null,
        ),
      );
    }
    content.append(grid);

    if (snapshot.favorited !== false) {
      content.append(
        el(
          "button",
          {
            class: "fav-item fav-remove",
            type: "button",
            onclick: () => {
              void apply(null);
            },
          },
          favoriteDot("var(--color-danger)"),
          el("span", { class: "fav-name", text: "Remove from favorites" }),
        ),
      );
    }

    content.append(
      el("a", {
        class: "fav-link",
        href: `${location.origin}/uconfig.php`,
        "data-native": "",
        target: "_blank",
        rel: "noopener",
        text: "Manage folders",
      }),
    );
  };

  const apply = async (folder: FavoriteFolder | null): Promise<void> => {
    content.replaceChildren();
    status.announce("Saving…");
    try {
      if ((await noteLoad) === null) {
        throw new Error("Could not read the saved note.");
      }
      await save(state, folder === null ? null : folder.slot, note.value.trim());
      state.set(folder !== null, folder);
      syncHeader();
      showToast(folder === null ? "Removed from favorites" : "Added to favorites");
      popover.close();
      // The panel's folder buttons are gone by now, so focus would fall back to <body>.
      anchor.focus();
    } catch (error) {
      const message = errorText(error, "Favorite update failed.");
      const retry = nativeLink("Retry in native dialog");
      content.replaceChildren(retry);
      status.announce(message);
      popover.reposition();
      // The folder button that held focus is gone; keep the recovery action reachable.
      retry.focus();
    }
  };

  status.announce("Loading folders…");

  // The note has to be known before any folder click can submit it, or a move would blank it, so
  // `apply` waits on this promise; the folder grid renders without waiting.
  // `null` means the read failed, which is not the same as "no note": posting an empty note would
  // erase the saved one, so a move waits and then refuses.
  const noteLoad: Promise<string | null> =
    state.get().favorited === true
      ? loadNote(controller.signal).catch(() => null)
      : Promise.resolve("");
  void noteLoad.then((savedNote) => {
    if (!controller.signal.aborted && note.value === "" && savedNote !== null) {
      note.value = savedNote;
    }
  });

  void loadFolders(controller.signal)
    .then((folders) => {
      renderFolders(folders);
      popover.reposition();
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      const message = errorText(error, "Could not load favorite folders.");
      const retry = nativeLink("Open native dialog");
      content.replaceChildren(retry);
      status.announce(message);
      popover.reposition();
      retry.focus();
    });
}

/** A star button wired to the favorite menu. */
export function favoriteButton(state: FavoriteState, signal?: AbortSignal): HTMLButtonElement {
  const button = el("button", {
    class: "fav-btn",
    type: "button",
    "aria-label": "Favorite",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    title: "Favorite",
  });
  const sync = (snapshot: FavoriteSnapshot = state.get()): void => {
    const favorited = snapshot.favorited;
    const folder = snapshot.folder;
    const label =
      favorited === true ? (folder === null || folder === "" ? "Favorited" : folder) : "Favorite";
    button.replaceChildren(
      icon("star", favorited === true),
      el("span", { class: "fav-label", text: label }),
    );
    button.classList.toggle("is-favorite", favorited === true);
    const action =
      favorited === true
        ? "Edit favorite"
        : favorited === false
          ? "Add to favorites"
          : "Favorite folders";
    button.setAttribute("aria-label", action);
    button.title = action;
  };
  sync();
  const unsubscribe = state.subscribe(sync);
  if (signal !== undefined) {
    if (signal.aborted) {
      unsubscribe();
    } else {
      signal.addEventListener("abort", unsubscribe, { once: true });
    }
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (activeMenu?.anchor === button) {
      closeFavoriteMenu();
      return;
    }
    openFavoriteMenu({ anchor: button, state });
  });
  return button;
}
