import { beforeEach, describe, expect, test } from "bun:test";

import {
  applyPersistedListFilters,
  saveListFilters,
  setListPanelOpen,
} from "../../src/data/list-filters";
import { replaceQuickTags } from "../../src/data/quick-tags";
import { emptySearchQuery, parseSearchQuery } from "../../src/parse/query";
import { parseRoute } from "../../src/router";
import { getSearchDraft } from "../../src/search-draft";
import type { ListPageData } from "../../src/types";
import { renderList } from "../../src/views/list";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";

const EMPTY: ListPageData = {
  url: "https://e-hentai.org/",
  items: [],
  prevHref: null,
  nextHref: null,
  resultText: "Found 0 results.",
};

const ONE: ListPageData = {
  ...EMPTY,
  items: [listItem()],
};

let host: HTMLElement;
let navigations: string[];

function render(search: string): void {
  const url = new URL(`https://e-hentai.org/?${search}`);
  Object.assign(globalThis, { location: url });
  renderList(
    host,
    EMPTY,
    parseSearchQuery(url),
    viewContext({ navigate: (next) => navigations.push(next) }),
  );
}

beforeEach(() => {
  installDom();
  saveListFilters(emptySearchQuery());
  setListPanelOpen(false);
  GM_setValue("eh:saved-expressions:v1", []);
  host = mountHost();
  navigations = [];
});

describe("renderList", () => {
  test("offers a way out of an empty result set instead of only the native page", () => {
    render("f_search=missing&f_srdd=4");

    const empty = host.querySelector(".empty-state");
    const reset = [...(empty?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "Clear search and filters",
    );
    expect(reset).toBeDefined();
    reset?.click();
    expect(navigations).toEqual(["/"]);
    expect(empty?.querySelector("a")?.textContent).toBe("Open native page");

    // Nothing to reset: no clear action and no active-filter summary.
    render("");
    expect(host.querySelector(".empty-state button")).toBeNull();
    expect(host.querySelector(".filters-active")).toBeNull();
  });

  test("applies advanced filters from the form and reopens with them", () => {
    render("f_search=test");
    const form = host.querySelector<HTMLFormElement>("form.filters-grid");
    const details = host.querySelector<HTMLDetailsElement>("details.filters");
    const rating = form?.querySelector<HTMLSelectElement>("select.field-select");
    const minPages = form?.querySelector<HTMLInputElement>('input[aria-label="Minimum pages"]');
    if (!form || !details || !rating || !minPages) {
      throw new Error("missing advanced filter fields");
    }
    details.setAttribute("open", "");
    details.dispatchEvent(new Event("toggle"));

    const options = [...rating.querySelectorAll<HTMLOptionElement>("option")];
    const any = options.find((option) => option.value === "0");
    const four = options.find((option) => option.value === "4");
    if (!any || !four) {
      throw new Error("missing rating options");
    }
    // A browser keeps the `selected` attribute on the default option after the user picks another
    // one. The live selection, not that stale attribute, is what Apply must read.
    for (const option of options) {
      option.removeAttribute("selected");
    }
    any.setAttribute("selected", "");
    Object.defineProperty(any, "selected", { configurable: true, value: false });
    Object.defineProperty(four, "selected", { configurable: true, value: true });
    minPages.value = "10";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(navigations).toHaveLength(1);
    const url = new URL(navigations[0] ?? "", "https://e-hentai.org");
    expect(url.searchParams.get("f_search")).toBe("test");
    expect(url.searchParams.get("f_srdd")).toBe("4");
    expect(url.searchParams.get("f_spf")).toBe("10");

    // The next page rebuilds the panel from the applied address and the remembered open state.
    renderList(host, { ...EMPTY, url: url.href }, parseSearchQuery(url), viewContext());
    expect(
      host
        .querySelector<HTMLSelectElement>("select.field-select")
        ?.querySelector<HTMLOptionElement>('option[value="4"]')?.selected,
    ).toBe(true);
    expect(host.querySelector<HTMLDetailsElement>("details.filters")?.hasAttribute("open")).toBe(
      true,
    );
  });

  test("a quick tag edits the draft without submitting a search", () => {
    replaceQuickTags([{ name: "LOLI", query: "f:lolicon$", savedAt: 1 }]);
    render("f_search=cat");

    const pill = host.querySelector<HTMLButtonElement>(".quick-tag");
    pill?.click();

    expect(getSearchDraft().text).toBe("cat f:lolicon$");
    expect(host.querySelector<HTMLInputElement>('input[name="f_search"]')?.value).toBe(
      "cat f:lolicon$",
    );
    expect(navigations).toEqual([]);
  });

  test("names a category listing and marks only that category enabled", () => {
    const url = new URL("https://e-hentai.org/doujinshi");
    Object.assign(globalThis, { location: url });
    const route = parseRoute(url.href);
    if (route.kind !== "list") {
      throw new Error("expected a list route");
    }
    renderList(host, EMPTY, route.query, viewContext(), route.scope);

    expect(host.querySelector(".list-heading h1")?.textContent).toBe("Doujinshi galleries");
    const pressed = [...host.querySelectorAll<HTMLButtonElement>(".cat-chip")].filter(
      (chip) => chip.getAttribute("aria-pressed") === "true",
    );
    expect(pressed.map((chip) => chip.textContent)).toEqual(["Doujinshi"]);
  });

  test("folds a tag from the parsed page URL into the search", () => {
    const chinese = new URL("https://e-hentai.org/tag/language:chinese");
    renderList(host, { ...EMPTY, url: chinese.href }, parseSearchQuery(chinese), viewContext());

    expect(host.querySelector(".list-heading h1")?.textContent).toBe("Search results");
    expect(host.querySelector<HTMLInputElement>(".topbar-search input")?.value).toBe("l:chinese$");

    const quoted = new URL("https://e-hentai.org/tag/artist:bob+smith");
    renderList(host, { ...EMPTY, url: quoted.href }, parseSearchQuery(quoted), viewContext());

    expect(host.querySelector<HTMLInputElement>(".topbar-search input")?.value).toBe(
      'a:"bob smith$"',
    );
  });

  test("remembers a category choice for a later session", () => {
    render("f_search=test");

    const chip = [...host.querySelectorAll<HTMLButtonElement>(".cat-chip")].find(
      (candidate) => candidate.textContent === "Doujinshi",
    );
    chip?.click();
    expect(navigations).toHaveLength(1);

    const listing = {
      kind: "list" as const,
      url: "https://e-hentai.org/",
      query: emptySearchQuery(),
      scope: "search" as const,
    };
    const resumed = applyPersistedListFilters(listing).url;
    expect(new URL(resumed).searchParams.get("f_cats")).toBe("2");
  });

  test("labels narrowing filters separately from relaxed toggles", () => {
    render("f_search=test&f_srdd=4&f_sfl=on");

    expect([...host.querySelectorAll(".list-summary .badge")].map((b) => b.textContent)).toEqual([
      "1 filter",
      "1 relaxed filter",
    ]);
    expect(host.querySelector(".filters-active")?.textContent).toBe(
      "4★ minimum · Language filter off",
    );

    render("f_search=test&f_srdd=4&f_spf=15&f_spt=30&f_sh=on&f_sto=on");
    expect(host.querySelector(".filters-active")?.textContent).toBe(
      "4★ minimum · 15–30 pages · Expunged included · Torrent required",
    );
  });

  test("outlines the posted date and fills the star when the gallery is favorited", () => {
    const url = new URL("https://e-hentai.org/?f_search=test");
    Object.assign(globalThis, { location: url });
    const item = ONE.items[0];
    if (!item) {
      throw new Error("fixture item missing");
    }
    renderList(
      host,
      { ...ONE, items: [{ ...item, favorite: { folder: "Read later", slot: 2 } }] },
      parseSearchQuery(url),
      viewContext(),
    );

    const posted = host.querySelector<HTMLElement>(".card-meta .card-posted");
    expect(posted?.classList.contains("is-favorite")).toBe(true);
    expect(posted?.getAttribute("title")).toBe("In favorites: Read later");
    expect(host.querySelector(".fav-btn")?.getAttribute("aria-label")).toBe("Edit favorite");
  });

  test("seek navigates from the current page without a numbered strip", () => {
    const url = new URL("https://e-hentai.org/?f_search=x&next=123");
    Object.assign(globalThis, { location: url });
    renderList(
      host,
      {
        ...ONE,
        url: url.href,
        prevHref: "/?f_search=x&prev=1",
        nextHref: "/?f_search=x&next=100",
      },
      parseSearchQuery(url),
      viewContext({ navigate: (next) => navigations.push(next) }),
    );

    const input = host.querySelector<HTMLInputElement>(".pager-seek-input");
    expect(input?.value).toBe("");
    if (input) {
      input.value = "2020-06";
    }
    host
      .querySelector<HTMLFormElement>(".pager-seek")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(navigations).toEqual(["/?f_search=x&seek=2020-06"]);
  });

  test("links to the site's own file search form", () => {
    render("");
    const link = host.querySelector<HTMLAnchorElement>(".filters-native");
    expect(link?.getAttribute("href")).toBe("https://upld.e-hentai.org/image_lookup.php");
    expect(link?.getAttribute("data-native")).toBe("");
  });
});
