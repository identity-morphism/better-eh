import { beforeEach, describe, expect, test } from "bun:test";

import type { FavoritesPage } from "../../src/parse/favorites";
import { renderFavorites } from "../../src/views/favorites";
import { flushMicrotasks } from "./async";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";

const PAGE_URL = "https://exhentai.org/favorites.php?favcat=0";

function favoriteItem(gid: string, name: string, pages: number | null) {
  return listItem({
    href: `/g/${gid}/${gid}/`,
    gid,
    token: gid,
    title: { leading: [], primary: name, secondary: null, trailing: [] },
    coverSrc: `https://img.example/${gid}.jpg`,
    coverSize: null,
    rating: null,
    uploader: null,
    posted: "",
    pages,
    torrentsHref: null,
  });
}

const data: FavoritesPage = {
  url: PAGE_URL,
  folders: [
    { slot: 0, name: "Good Stuff", count: 46 },
    { slot: 1, name: "Plan to Read", count: 7 },
  ],
  active: 0,
  order: "published",
  items: [favoriteItem("101", "Alpha", 12), favoriteItem("102", "Beta", null)],
  notes: new Map([["102", "Read later"]]),
  search: "",
  nextHref: "https://exhentai.org/favorites.php?next=1-0",
  prevHref: null,
  summary: null,
};

let host: HTMLElement;
let document: Document;
let removals: string[][];
let moves: { gids: string[]; slot: number }[];

const remove = (gids: readonly string[]): Promise<void> => {
  removals.push([...gids]);
  return Promise.resolve();
};

const move = (gids: readonly string[], slot: number): Promise<void> => {
  moves.push({ gids: [...gids], slot });
  return Promise.resolve();
};

function render(): void {
  renderFavorites(host, data, viewContext(), { remove, move });
}

function summary(): string | null | undefined {
  return host.querySelector(".list-summary")?.textContent;
}

function select(gid: string): HTMLInputElement {
  const box = host.querySelector<HTMLInputElement>(`.favorites-checkbox[value="${gid}"]`);
  if (!box) {
    throw new Error(`missing checkbox for ${gid}`);
  }
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  return box;
}

function checkedGids(): string[] {
  return [...host.querySelectorAll<HTMLInputElement>(".favorites-checkbox")]
    .filter((box) => box.checked)
    .map((box) => box.value);
}

beforeEach(() => {
  document = installDom(PAGE_URL);
  host = mountHost(document);
  removals = [];
  moves = [];
  render();
});

describe("renderFavorites", () => {
  test("renders folder tabs with counts, marks the active folder and builds links from the page URL", () => {
    expect(
      [...host.querySelectorAll(".favorites-tab-name")].map((node) => node.textContent),
    ).toEqual(["All", "Good Stuff", "Plan to Read"]);
    expect(
      [...host.querySelectorAll(".favorites-tab-count")].map((node) => node.textContent),
    ).toEqual(["53", "46", "7"]);

    const current = host.querySelectorAll('.favorites-tab[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector(".favorites-tab-name")?.textContent).toBe("Good Stuff");
    expect(current[0]?.getAttribute("href")).toBe(PAGE_URL);

    Object.assign(globalThis, { location: new URL("https://e-hentai.org/elsewhere") });
    render();
    expect(host.querySelector<HTMLAnchorElement>(".favorites-tab")?.getAttribute("href")).toBe(
      "https://exhentai.org/favorites.php",
    );
  });

  test("renders cards with category and saved notes", () => {
    expect(host.querySelectorAll(".favorites-card")).toHaveLength(2);
    expect(host.querySelector(".favorites-card .cat-badge")?.textContent).toBe("Doujinshi");
    expect(host.querySelector(".favorites-note")?.textContent).toBe("Read later");
    expect(host.querySelectorAll(".favorites-checkbox")).toHaveLength(2);
  });

  test("shows the bulk bar only while a card is selected", () => {
    const bar = host.querySelector<HTMLElement>(".favorites-bulk");
    expect(bar?.hidden).toBe(true);

    const box = select("101");
    expect(bar?.hidden).toBe(false);
    expect(host.querySelector(".favorites-bulk-count")?.textContent).toBe("1 selected");
    expect(host.querySelector<HTMLButtonElement>(".favorites-retry")?.hidden).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(bar?.hidden).toBe(true);
  });

  test("measures the bulk spacer only when the bar appears or disappears", () => {
    // linkedom has no viewport, so give syncBulkSpace one that measures.
    window.innerHeight = 800;
    const bar = host.querySelector<HTMLElement>(".favorites-bulk");
    const spacer = host.querySelector<HTMLElement>(".favorites-bulk-spacer");
    if (!bar || !spacer) {
      throw new Error("missing bulk bar");
    }
    const real = bar.getBoundingClientRect.bind(bar);
    let measured = 0;
    bar.getBoundingClientRect = () => {
      measured += 1;
      return real();
    };

    select("101");
    expect(measured).toBe(1);
    expect(spacer.hidden).toBe(false);

    // A second card only changes the count, not the bar's footprint.
    select("102");
    select("101");
    expect(measured).toBe(1);

    // Hiding the bar needs no measurement: the spacer simply collapses.
    select("102");
    expect(measured).toBe(1);
    expect(spacer.hidden).toBe(true);
    expect(bar.hidden).toBe(true);
  });

  test("deletes the selected galleries and clears the selection", async () => {
    select("101");
    select("102");

    // Bulk delete arms first and executes on the second click.
    host.querySelector<HTMLButtonElement>(".favorites-delete")?.click();
    expect(host.querySelector<HTMLButtonElement>(".favorites-delete")?.textContent).toBe(
      "Delete 2?",
    );
    host.querySelector<HTMLButtonElement>(".favorites-delete")?.click();
    await flushMicrotasks(2);

    expect(removals).toEqual([["101", "102"]]);
    expect(host.querySelector<HTMLElement>(".favorites-bulk")?.hidden).toBe(true);
    expect(checkedGids()).toEqual([]);
  });

  test("arms delete again when the selection changes after a confirmation", () => {
    const button = host.querySelector<HTMLButtonElement>(".favorites-delete");
    select("101");
    button?.click();
    expect(button?.textContent).toBe("Delete 1?");
    expect(button?.classList.contains("is-armed")).toBe(true);

    // A different selection must not inherit the previous confirmation or its count.
    select("102");
    expect(button?.textContent).toBe("Delete");
    expect(button?.classList.contains("is-armed")).toBe(false);

    button?.click();
    expect(button?.textContent).toBe("Delete 2?");
  });

  test("moves the selected galleries into the chosen folder", async () => {
    select("102");

    host.querySelector<HTMLButtonElement>(".favorites-move")?.click();
    const choices = [...document.body.querySelectorAll<HTMLButtonElement>(".favorites-move-item")];
    expect(
      choices.map((choice) => choice.querySelector(".favorites-move-name")?.textContent),
    ).toEqual(["Good Stuff", "Plan to Read"]);
    expect(
      choices.map((choice) => choice.querySelector(".favorites-move-count")?.textContent),
    ).toEqual(["46", "7"]);

    choices
      .find(
        (choice) => choice.querySelector(".favorites-move-name")?.textContent === "Plan to Read",
      )
      ?.click();
    await flushMicrotasks(2);

    expect(moves).toEqual([{ gids: ["102"], slot: 1 }]);
    expect(host.querySelector<HTMLElement>(".favorites-bulk")?.hidden).toBe(true);
  });

  test("keeps the selection and offers Retry when a mutation fails", async () => {
    let attempts = 0;
    const flaky = (): Promise<void> => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("Network down")) : Promise.resolve();
    };

    renderFavorites(host, data, viewContext(), { remove: flaky, move });
    select("101");

    host.querySelector<HTMLButtonElement>(".favorites-delete")?.click();
    host.querySelector<HTMLButtonElement>(".favorites-delete")?.click();
    await flushMicrotasks(2);

    const status = host.querySelector<HTMLElement>(".favorites-bulk-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("Network down");
    expect(checkedGids()).toEqual(["101"]);

    const retry = host.querySelector<HTMLButtonElement>(".favorites-retry");
    expect(retry?.hidden).toBe(false);
    retry?.click();
    await flushMicrotasks(2);

    expect(attempts).toBe(2);
    expect(host.querySelector<HTMLElement>(".favorites-bulk")?.hidden).toBe(true);
    expect(checkedGids()).toEqual([]);
  });

  test("summarizes the visible slice of the active folder", () => {
    expect(summary()).toBe("Showing 1 - 2 of 46 favorites");

    renderFavorites(host, { ...data, active: "all" }, viewContext(), { remove, move });
    expect(summary()).toBe("Showing 1 - 2 of 53 favorites");
  });

  test("derives the position from the last, numbered or cursor page", () => {
    renderFavorites(
      host,
      { ...data, prevHref: `${PAGE_URL}&prev=1-0`, nextHref: null },
      viewContext(),
      { remove, move },
    );
    expect(summary()).toBe("Showing 45 - 46 of 46 favorites");

    renderFavorites(host, { ...data, url: `${PAGE_URL}&page=2` }, viewContext(), {
      remove,
      move,
    });
    expect(summary()).toBe("Showing 5 - 6 of 46 favorites");

    renderFavorites(host, { ...data, prevHref: `${PAGE_URL}&prev=1-0` }, viewContext(), {
      remove,
      move,
    });
    expect(summary()).toBe("Showing 2 of 46 favorites");
  });

  test("falls back to the item count when the folder total is unknown", () => {
    renderFavorites(host, { ...data, folders: [] }, viewContext(), { remove, move });
    expect(summary()).toBe("2 favorites");
  });

  test("selects every card from the check row", () => {
    const box = host.querySelector<HTMLInputElement>(".favorites-toolbar .check input");
    if (box === null) {
      throw new Error("missing select all checkbox");
    }

    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));

    expect(checkedGids()).toEqual(["101", "102"]);
    expect(host.querySelector(".favorites-bulk-count")?.textContent).toBe("2 selected");
  });

  test("uses the shared state panel for an empty folder", () => {
    renderFavorites(
      host,
      {
        ...data,
        folders: [{ slot: 0, name: "Good Stuff", count: 0 }],
        items: [],
        notes: new Map(),
      },
      viewContext(),
      { remove, move },
    );

    const panel = host.querySelector<HTMLElement>(".empty-state");
    expect(panel?.textContent).toContain("This folder has no favorites yet.");

    const actions = [...(panel?.querySelectorAll<HTMLAnchorElement>(".state-actions a") ?? [])];
    expect(actions.map((action) => action.textContent)).toEqual([
      "Show all favorites",
      "Browse galleries",
      "Open native page",
    ]);
    expect(actions[0]?.getAttribute("href")).toBe("https://exhentai.org/favorites.php");
    expect(actions[2]?.getAttribute("href")).toBe(`${PAGE_URL}&eh_native=1`);
  });

  test("searches inside the active folder and keeps the query in folder links", () => {
    const navigations: string[] = [];
    renderFavorites(host, data, viewContext({ navigate: (url) => navigations.push(url) }), {
      remove,
      move,
    });

    const input = host.querySelector<HTMLInputElement>(".favorites-search-input");
    if (!input) {
      throw new Error("missing favorites search field");
    }
    input.value = "alpha";
    host
      .querySelector<HTMLFormElement>(".favorites-search")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(navigations).toEqual([
      "/favorites.php?favcat=0&f_search=alpha&f_apply=Search%2BFavorites",
    ]);

    // Folder and search links restart at the first page, dropping a stale cursor.
    renderFavorites(
      host,
      {
        ...data,
        url: "https://exhentai.org/favorites.php?favcat=0&f_search=alpha&page=2",
        search: "alpha",
      },
      viewContext(),
      { remove, move },
    );
    const tabs = [...host.querySelectorAll<HTMLAnchorElement>(".favorites-tab")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "https://exhentai.org/favorites.php?f_search=alpha",
      "https://exhentai.org/favorites.php?f_search=alpha&favcat=0",
      "https://exhentai.org/favorites.php?f_search=alpha&favcat=1",
    ]);
    expect(summary()).toBe("2 matches");
  });
});
