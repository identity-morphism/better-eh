import { deleteFavorites, moveFavorites } from "../data/favorites";
import type { FavoriteOrder, FavoritesPage } from "../parse/favorites";
import { formatPageRange } from "../parse/gallery";
import type { ListItem } from "../types";
import { createCardGrid } from "../ui/card-grid";
import { el } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { trackScrollEdges } from "../ui/jump-row";
import { listHeader } from "../ui/list-header";
import { pager } from "../ui/pager";
import type { Popover } from "../ui/popover";
import { openPopover } from "../ui/popover";
import { resultCard } from "../ui/result-card";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { plural } from "../ui/text";
import { showToast } from "../ui/toast";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";
import { createSelection } from "./favorites-selection";

const FAVORITES_PATH = "/favorites.php";
const ORDER_PARAM: Record<FavoriteOrder, string> = { published: "fs_p", favorited: "fs_f" };

interface BulkAction {
  run: () => Promise<void>;
  success: string;
}

/** Injectable mutations; the production defaults post to the site. */
interface FavoritesViewDeps {
  remove?: typeof deleteFavorites;
  move?: typeof moveFavorites;
}

/** The names the favorites page wears: grid heading and tab title. */
interface FavoritesLabels {
  /** Heading above the grid. */
  heading: string;
  /** Document-title parts without the site name; the active folder comes first when there is one. */
  title: readonly string[];
}

/**
 * Name the favorites page once.
 *
 * The heading always names the page ("Favorites"), while the tab title starts with the active
 * folder. The difference is intentional: the folder is where you are, the heading is what the page
 * is. The active tab takes its label from the same folder entry, so the two cannot disagree.
 */
export function favoritesLabels(data: FavoritesPage): FavoritesLabels {
  const active =
    data.active === "all"
      ? null
      : (data.folders.find((folder) => folder.slot === data.active) ?? null);
  return {
    heading: "Favorites",
    title: active === null ? ["Favorites"] : [active.name, "Favorites"],
  };
}

/** Favorites in the active folder, from the tab strip; null when the page does not carry them. */
function folderTotal(data: FavoritesPage): number | null {
  if (data.active === "all") {
    if (data.folders.length === 0) {
      return null;
    }
    return data.folders.reduce((total, folder) => total + folder.count, 0);
  }
  return data.folders.find((folder) => folder.slot === data.active)?.count ?? null;
}

/**
 * Number of the first card on this page, or null when cursor paging hides it.
 *
 * A `page` parameter names the position outright. The favorites pager mostly uses cursor links,
 * where only the first page and the last page say where they sit; a full page in between knows its
 * size but not its offset.
 */
function pageStart(data: FavoritesPage, total: number, count: number): number | null {
  const rawPage = new URL(data.url).searchParams.get("page");
  const page = rawPage === null ? Number.NaN : Number(rawPage);
  const lastPageStart = Math.max(1, total - count + 1);

  if (Number.isInteger(page) && page >= 0) {
    if (page === 0) {
      return 1;
    }
    return data.nextHref === null ? lastPageStart : page * count + 1;
  }
  if (data.prevHref === null) {
    return 1;
  }
  return data.nextHref === null ? lastPageStart : null;
}

/**
 * Header line: how much of the folder this page shows, so the page size is never mistaken for the
 * folder's size. Falls back to the page's own count when the folder total is unknown.
 */
function summaryText(data: FavoritesPage): string {
  if (data.search !== "") {
    return data.summary ?? `${data.items.length} ${plural(data.items.length, "match", "matches")}`;
  }
  const count = data.items.length;
  const items = `${count} ${plural(count, "favorite", "favorites")}`;
  const total = folderTotal(data);
  if (total === null || total < count || count === 0) {
    return data.summary ?? items;
  }

  const noun = plural(total, "favorite", "favorites");
  const start = pageStart(data, total, count);
  return start === null
    ? `Showing ${count} of ${total} ${noun}`
    : formatPageRange({ start, end: start + count - 1, total, suffix: ` ${noun}` });
}

function folderHref(baseUrl: string, active: number | "all"): string {
  const url = new URL(FAVORITES_PATH, baseUrl);
  // Keep the search text and sort order; only the folder and the page cursors change.
  for (const [key, value] of new URL(baseUrl).searchParams) {
    if (key !== "favcat" && key !== "next" && key !== "prev") {
      url.searchParams.set(key, value);
    }
  }
  if (active !== "all") {
    url.searchParams.set("favcat", String(active));
  }
  return url.href;
}

function orderHref(baseUrl: string, active: number | "all", order: FavoriteOrder): string {
  const url = new URL(folderHref(baseUrl, active));
  url.searchParams.set("inline_set", ORDER_PARAM[order]);
  return url.href;
}

function folderTab(label: string, count: number, href: string, active: boolean): HTMLAnchorElement {
  return el(
    "a",
    {
      class: active ? "favorites-tab is-active" : "favorites-tab",
      href,
      title: label,
      "aria-current": active ? "page" : null,
    },
    el("span", { class: "favorites-tab-name", text: label }),
    el("span", { class: "favorites-tab-count", text: String(count) }),
  );
}

function orderLink(
  baseUrl: string,
  order: FavoriteOrder,
  label: string,
  active: number | "all",
  current: FavoriteOrder,
): HTMLAnchorElement {
  const selected = order === current;
  return el("a", {
    class: selected ? "favorites-order-link is-active" : "favorites-order-link",
    href: orderHref(baseUrl, active, order),
    "aria-current": selected ? "true" : null,
    text: label,
  });
}

/**
 * Render `/favorites.php`: folder tabs, the favorites grid with saved notes, bulk delete/move, and
 * pagination.
 *
 * `deps` swaps the mutation calls in tests; both default to the real same-origin POSTs. A
 * successful mutation re-runs the route so folder counts, the grid and the summary all reflect the
 * server's new state.
 */
export function renderFavorites(
  host: HTMLElement,
  data: FavoritesPage,
  ctx: ViewContext,
  deps?: FavoritesViewDeps,
): void {
  host.replaceChildren();

  const labels = favoritesLabels(data);
  const remove = deps?.remove ?? deleteFavorites;
  const move = deps?.move ?? moveFavorites;

  const selection = createSelection(data.items.map((item) => item.gid));
  let busy = false;
  let retryAction: BulkAction | null = null;
  let movePopover: Popover | null = null;
  let armedDelete = false;
  let armedCount = 0;
  let armTimer: number | undefined;

  const countLabel = el("span", { class: "favorites-bulk-count" });
  const statusText = el("span", { class: "favorites-bulk-status", role: "status" });
  statusText.hidden = true;

  const retryButton = el("button", {
    class: "btn btn-small favorites-retry",
    type: "button",
    text: "Retry",
  });
  const removeButton = el("button", {
    class: "btn btn-small favorites-delete",
    type: "button",
    text: "Delete",
  });
  const moveButton = el("button", {
    class: "btn btn-small favorites-move",
    type: "button",
    text: "Move to…",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });

  const bar = el(
    "div",
    { class: "favorites-bulk", role: "region", "aria-label": "Selected favorites" },
    countLabel,
    statusText,
    retryButton,
    removeButton,
    moveButton,
  );
  bar.hidden = true;
  // The bar is fixed, so it cannot push the pager out of its own way. A measured tail spacer
  // guarantees enough scrollable room for the last controls to clear it while it is on screen.
  const bulkSpacer = el("div", { class: "favorites-bulk-spacer" });
  bulkSpacer.hidden = true;

  const syncBulkSpace = (): void => {
    const viewport = window.innerHeight;
    if (bar.hidden || !Number.isFinite(viewport) || viewport <= 0) {
      bulkSpacer.hidden = true;
      bulkSpacer.style.height = "";
      return;
    }
    bulkSpacer.hidden = false;
    const clearance = Math.ceil(viewport - bar.getBoundingClientRect().top);
    bulkSpacer.style.height = `${Math.max(0, clearance) + 8}px`;
  };

  const selectAll = el("input", { class: "favorites-check-all", type: "checkbox" });
  const grid = createCardGrid(ctx.signal);

  const disarmDelete = (): void => {
    armedDelete = false;
    armedCount = 0;
    clearTimeout(armTimer);
    removeButton.classList.remove("is-armed");
    removeButton.textContent = "Delete";
  };

  const syncBar = (): void => {
    const total = selection.size;
    bar.hidden = total === 0;
    countLabel.textContent = `${total} selected`;
    statusText.hidden = retryAction === null;
    retryButton.hidden = retryAction === null;
    removeButton.disabled = total === 0 || busy;
    moveButton.disabled = total === 0 || busy;
    retryButton.disabled = busy;
    // A confirmation names the count it will delete; a different selection needs a fresh one.
    if (total === 0 || (armedDelete && total !== armedCount)) {
      disarmDelete();
    }
    selectAll.checked = selection.all;
    selectAll.indeterminate = selection.some && !selection.all;
    for (const box of grid.element.querySelectorAll<HTMLInputElement>(".favorites-checkbox")) {
      box.checked = selection.has(box.value);
    }
    syncBulkSpace();
  };

  const perform = async (action: BulkAction): Promise<void> => {
    if (busy || selection.size === 0) {
      return;
    }
    busy = true;
    retryAction = null;
    statusText.hidden = true;
    syncBar();

    try {
      await action.run();
      showToast(action.success);
      selection.clear();
      busy = false;
      syncBar();
      // The removed cards, folder counts and summary are stale until the page is re-read.
      ctx.reload();
    } catch (error) {
      retryAction = action;
      statusText.textContent = errorText(error, "Favorite update failed.");
    } finally {
      busy = false;
      syncBar();
      // The clicked action was disabled while the request ran; put focus on the recovery path.
      if (retryAction !== null) {
        retryButton.focus();
      }
    }
  };

  const openMoveMenu = (): void => {
    movePopover?.close();

    const content = el(
      "div",
      { class: "favorites-move-panel", role: "none" },
      el("div", { class: "favorites-move-head", role: "presentation", text: "Move to folder" }),
    );

    if (data.folders.length === 0) {
      content.append(
        el("div", { class: "favorites-move-empty", text: "No favorite folders found." }),
      );
    }

    for (const folder of data.folders) {
      const choice = el(
        "button",
        { class: "favorites-move-item", type: "button", role: "menuitem" },
        el("span", { class: "favorites-move-name", text: folder.name }),
        el("span", { class: "favorites-move-count", text: String(folder.count) }),
      );
      choice.addEventListener(
        "click",
        () => {
          movePopover?.close();
          const gids = selection.ids();
          void perform({
            run: () => move(gids, folder.slot, ctx.signal),
            success: `Moved ${gids.length} ${plural(gids.length, "favorite", "favorites")} to ${folder.name}`,
          });
        },
        { signal: ctx.signal },
      );
      content.append(choice);
    }

    movePopover = openPopover({
      content,
      anchor: moveButton,
      role: "menu",
      label: "Move to folder",
      align: "end",
      autoFocus: true,
      signal: ctx.signal,
      onClose: () => {
        movePopover = null;
      },
    });
  };

  const buildCard = (item: ListItem): HTMLElement => {
    const checkbox = el("input", {
      class: "favorites-checkbox",
      type: "checkbox",
      name: "modifygids[]",
      value: item.gid,
      "aria-label": `Select ${item.title.primary}`,
    });
    // `change` carries no modifiers; remember whether the click that causes it held shift.
    let shift = false;
    checkbox.addEventListener("click", (event) => {
      shift = event.shiftKey;
    });
    checkbox.addEventListener(
      "change",
      () => {
        selection.toggle(item.gid, { shift });
        shift = false;
      },
      { signal: ctx.signal },
    );

    const select = el("label", { class: "favorites-select", title: "Select favorite" }, checkbox);

    return resultCard(item, ctx.signal, {
      className: "favorites-card",
      cover: select,
      note: data.notes.get(item.gid),
    });
  };

  grid.append(data.items.map(buildCard));

  selectAll.addEventListener(
    "change",
    () => {
      selection.setAll(selectAll.checked);
    },
    { signal: ctx.signal },
  );

  removeButton.addEventListener(
    "click",
    () => {
      if (selection.size === 0 || busy) {
        return;
      }
      // Two steps: a bulk delete that removes a whole folder's page needs a deliberate confirm.
      if (!armedDelete) {
        armedDelete = true;
        armedCount = selection.size;
        removeButton.classList.add("is-armed");
        removeButton.textContent = `Delete ${selection.size}?`;
        armTimer = window.setTimeout(disarmDelete, 4000);
        return;
      }
      disarmDelete();
      const gids = selection.ids();
      void perform({
        run: () => remove(gids, ctx.signal),
        success: `Deleted ${gids.length} ${plural(gids.length, "favorite", "favorites")}`,
      });
    },
    { signal: ctx.signal },
  );
  moveButton.addEventListener("click", openMoveMenu, { signal: ctx.signal });
  retryButton.addEventListener(
    "click",
    () => {
      if (retryAction) {
        void perform(retryAction);
      }
    },
    { signal: ctx.signal },
  );

  const tabs = el("nav", { class: "favorites-tabs", "aria-label": "Favorite folders" });
  let allCount = 0;
  for (const folder of data.folders) {
    allCount += folder.count;
    const active = data.active === folder.slot;
    tabs.append(folderTab(folder.name, folder.count, folderHref(data.url, folder.slot), active));
  }
  tabs.prepend(folderTab("All", allCount, folderHref(data.url, "all"), data.active === "all"));

  const order = el(
    "div",
    { class: "favorites-order", role: "group", "aria-label": "Sort favorites" },
    el("span", { class: "favorites-order-label", text: "Order:" }),
    orderLink(data.url, "published", "Published Time", data.active, data.order),
    orderLink(data.url, "favorited", "Favorited Time", data.active, data.order),
  );

  const toolbar = el(
    "div",
    { class: "favorites-toolbar" },
    data.items.length > 0
      ? el(
          "label",
          { class: "check text-control" },
          selectAll,
          el("span", { text: "Select all on this page" }),
        )
      : null,
  );

  const header = listHeader({
    title: labels.heading,
    summary: [el("span", { text: summaryText(data) })],
  });

  const footer =
    data.items.length === 0
      ? statePanel({
          text:
            data.active === "all"
              ? "You have no favorites yet."
              : "This folder has no favorites yet.",
          actions: [
            ...(data.active === "all"
              ? []
              : [{ label: "Show all favorites", href: folderHref(data.url, "all") }]),
            { label: "Browse galleries", href: "/", primary: true },
            nativePageAction(),
          ],
        })
      : pager({
          prev: data.prevHref,
          next: data.nextHref,
          label: "Favorite pages",
        });

  const search = el("form", { class: "favorites-search", role: "search" });
  const searchInput = el("input", {
    class: "field-input favorites-search-input",
    type: "search",
    name: "f_search",
    value: data.search,
    placeholder: "Search favorites",
    "aria-label": "Search favorites",
  });
  search.append(
    searchInput,
    el("button", { class: "btn btn-small", type: "submit", text: "Search" }),
  );
  search.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const url = new URL(folderHref(data.url, data.active));
      const text = searchInput.value.trim();
      if (text === "") {
        url.searchParams.delete("f_search");
        url.searchParams.delete("f_apply");
      } else {
        url.searchParams.set("f_search", text);
        url.searchParams.set("f_apply", "Search+Favorites");
      }
      ctx.navigate(`${url.pathname}${url.search}`);
    },
    { signal: ctx.signal },
  );

  host.append(siteNav(ctx.signal), header, search, tabs, order, toolbar);
  if (data.items.length > 0) {
    host.append(grid.element);
    grid.refresh();
  }
  host.append(bar, footer, bulkSpacer);

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(syncBulkSpace);
    observer.observe(bar);
    ctx.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }
  window.addEventListener("resize", syncBulkSpace, { passive: true, signal: ctx.signal });

  // On phones the tab strip scrolls; the folder being viewed must not start off-screen. The
  // scroll edges drive the fades, so the leading tab is not hard-clipped mid-word.
  const activeTab = tabs.querySelector<HTMLElement>(".favorites-tab.is-active");
  if (activeTab !== null) {
    tabs.scrollLeft = Math.max(
      0,
      activeTab.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2,
    );
  }
  trackScrollEdges(tabs, ctx.signal);

  const unsubscribe = selection.subscribe(syncBar);
  ctx.signal.addEventListener("abort", unsubscribe, { once: true });
  syncBar();
}
