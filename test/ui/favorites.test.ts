import { beforeEach, describe, expect, test } from "bun:test";

import type { FavoritesPage } from "../../src/parse/favorites";
import { renderFavorites } from "../../src/views/favorites";
import { flushMicrotasks } from "./async";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";

const PAGE_URL = "https://exhentai.org/favorites.php?favcat=0";

const data: FavoritesPage = {
  url: PAGE_URL,
  folders: [
    { slot: 0, name: "Good Stuff", count: 46 },
    { slot: 1, name: "Plan to Read", count: 7 },
  ],
  active: 0,
  order: "published",
  items: [
    listItem({
      href: "/g/101/aaaa/",
      gid: "101",
      token: "aaaa",
      title: { leading: [], primary: "Alpha", secondary: null, trailing: [] },
      coverSrc: "https://img.example/101.jpg",
      coverSize: null,
      rating: null,
      uploader: null,
      posted: "",
      pages: 12,
      torrentsHref: null,
    }),
    listItem({
      href: "/g/102/bbbb/",
      gid: "102",
      token: "bbbb",
      title: { leading: [], primary: "Beta", secondary: null, trailing: [] },
      coverSrc: "https://img.example/102.jpg",
      coverSize: null,
      rating: null,
      uploader: null,
      posted: "",
      pages: null,
      torrentsHref: null,
    }),
  ],
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
  test("renders folder tabs with counts and marks the active folder", () => {
    const tabs = host.querySelectorAll(".favorites-tab");
    expect(tabs).toHaveLength(3);
    expect(
      [...host.querySelectorAll(".favorites-tab-name")].map((node) => node.textContent),
    ).toEqual(["All", "Good Stuff", "Plan to Read"]);
    expect(
      [...host.querySelectorAll(".favorites-tab-count")].map((node) => node.textContent),
    ).toEqual(["53", "46", "7"]);

    const current = host.querySelectorAll('.favorites-tab[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector(".favorites-tab-name")?.textContent).toBe("Good Stuff");
    expect(current[0]?.getAttribute("href")).toBe("https://exhentai.org/favorites.php?favcat=0");
    expect(host.querySelector<HTMLAnchorElement>(".favorites-tab")?.getAttribute("href")).toBe(
      "https://exhentai.org/favorites.php",
    );
  });

  test("renders cards with category and saved notes", () => {
    expect(host.querySelectorAll(".favorites-card")).toHaveLength(2);
    expect(host.querySelectorAll(".favorites-card .fav-btn")).toHaveLength(2);
    expect(host.querySelector(".cat-badge")?.textContent).toBe("Doujinshi");
    expect(host.querySelectorAll(".favorites-note")).toHaveLength(1);
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

  const summaryCases: Array<{ name: string; page: FavoritesPage; expected: string }> = [
    {
      name: "says which slice of the folder this page shows",
      page: data,
      expected: "Showing 1 - 2 of 46 favorites",
    },
    {
      name: "counts every folder on the All tab",
      page: { ...data, active: "all" },
      expected: "Showing 1 - 2 of 53 favorites",
    },
    {
      name: "describes the last page from the folder total",
      page: { ...data, prevHref: `${PAGE_URL}&prev=1-0`, nextHref: null },
      expected: "Showing 45 - 46 of 46 favorites",
    },
    {
      name: "uses the page parameter when the site pager provides one",
      page: { ...data, url: `${PAGE_URL}&page=2` },
      expected: "Showing 5 - 6 of 46 favorites",
    },
    {
      name: "leaves out the offset on a cursor page that hides it",
      page: { ...data, prevHref: `${PAGE_URL}&prev=1-0` },
      expected: "Showing 2 of 46 favorites",
    },
    {
      name: "falls back to the item count when the folder total is unknown",
      page: { ...data, folders: [] },
      expected: "2 favorites",
    },
  ];

  for (const { name, page, expected } of summaryCases) {
    test(name, () => {
      renderFavorites(host, page, viewContext(), { remove, move });

      expect(summary()).toBe(expected);
    });
  }

  test("builds folder links from the parsed page URL, not the ambient address", () => {
    Object.assign(globalThis, { location: new URL("https://e-hentai.org/elsewhere") });
    render();

    expect(host.querySelector<HTMLAnchorElement>(".favorites-tab")?.getAttribute("href")).toBe(
      "https://exhentai.org/favorites.php",
    );
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

    renderFavorites(
      host,
      {
        ...data,
        url: "https://exhentai.org/favorites.php?favcat=0&f_search=alpha",
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

  test("a folder or search link drops the page cursor", () => {
    renderFavorites(
      host,
      { ...data, url: "https://exhentai.org/favorites.php?favcat=0&page=2", search: "" },
      viewContext(),
      { remove, move },
    );

    const tabs = [...host.querySelectorAll<HTMLAnchorElement>(".favorites-tab")].map((tab) =>
      tab.getAttribute("href"),
    );
    expect(tabs).not.toHaveLength(0);
    expect(tabs.every((href) => href?.includes("page=") !== true)).toBe(true);
  });
});
