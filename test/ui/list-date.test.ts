import { beforeEach, describe, expect, test } from "bun:test";

import { saveListFilters, setListPanelOpen } from "../../src/data/list-filters";
import { emptySearchQuery, parseSearchQuery } from "../../src/parse/query";
import { updateSetting } from "../../src/settings";
import type { ListItem, ListPageData } from "../../src/types";
import { renderList } from "../../src/views/list";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";
import { installTestObservers, lastObserver, settle } from "./observers";

const BASE = "https://e-hentai.org/";
const RANGE_URL = "https://e-hentai.org/?f_search=dogs&eh_since=2024-01-01&eh_until=2024-12-31";
const NEXT_URL = "https://e-hentai.org/?f_search=dogs&p=1";

let host: HTMLElement;
let navigations: string[];

function dated(gid: string, posted: string, title: string): ListItem {
  return listItem({
    href: `/g/${gid}/${gid}/`,
    gid,
    token: gid,
    title: { leading: [], primary: title, secondary: null, trailing: [] },
    posted,
  });
}

function page(items: ListItem[], overrides: Partial<ListPageData> = {}): ListPageData {
  return {
    url: RANGE_URL,
    items,
    prevHref: null,
    nextHref: null,
    resultText: "Found 500 results.",
    ...overrides,
  };
}

function render(
  data: ListPageData,
  url = data.url,
  deps: NonNullable<Parameters<typeof renderList>[5]> = {},
): void {
  const address = new URL(url);
  Object.assign(globalThis, { location: address });
  renderList(
    host,
    data,
    parseSearchQuery(address),
    viewContext({ navigate: (next) => navigations.push(next) }),
    "search",
    deps,
  );
}

beforeEach(() => {
  installDom();
  installTestObservers();
  saveListFilters(emptySearchQuery());
  setListPanelOpen(false);
  updateSetting("listInfiniteScroll", false);
  host = mountHost();
  navigations = [];
});

describe("posted-date range in the filter panel", () => {
  test("renders posted-since and posted-until date fields", () => {
    render(page([]), `${BASE}?f_search=dogs`);

    const since = host.querySelector<HTMLInputElement>('input[aria-label="Posted since"]');
    const until = host.querySelector<HTMLInputElement>('input[aria-label="Posted until"]');

    expect(since?.getAttribute("type")).toBe("date");
    expect(until?.getAttribute("type")).toBe("date");
    expect(since?.getAttribute("placeholder")).toBe("YYYY-MM-DD");
    expect(until?.getAttribute("placeholder")).toBe("YYYY-MM-DD");
    expect(since?.getAttribute("title")).toContain("on or after");
    expect(until?.getAttribute("title")).toContain("on or before");
  });

  test("applies the range through the existing filter form", () => {
    render(page([]), `${BASE}?f_search=dogs`);

    const form = host.querySelector<HTMLFormElement>("form.filters-grid");
    const since = host.querySelector<HTMLInputElement>('input[aria-label="Posted since"]');
    const until = host.querySelector<HTMLInputElement>('input[aria-label="Posted until"]');
    if (!form || !since || !until) {
      throw new Error("missing date range fields");
    }

    since.value = "2024-01-01";
    until.value = "2024-12-31";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(navigations).toHaveLength(1);
    const url = new URL(navigations[0] ?? "", BASE);
    expect(url.searchParams.get("f_search")).toBe("dogs");
    expect(url.searchParams.get("eh_since")).toBe("2024-01-01");
    expect(url.searchParams.get("eh_until")).toBe("2024-12-31");
    expect(url.searchParams.get("advsearch")).toBe("1");
  });

  test("resets the range with the rest of the advanced filters", () => {
    render(page([]), RANGE_URL);

    const reset = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Reset",
    );
    reset?.click();

    expect(navigations).toHaveLength(1);
    const url = new URL(navigations[0] ?? "", BASE);
    expect(url.searchParams.get("f_search")).toBe("dogs");
    expect(url.searchParams.get("eh_since")).toBeNull();
    expect(url.searchParams.get("eh_until")).toBeNull();
  });
});

describe("posted-date range rendering", () => {
  test("shows only in-range cards, an approximate count and no next page past since", () => {
    const data = page(
      [
        dated("111", "2024-12-31 23:00", "Newest"),
        dated("222", "2024-06-01 09:00", "Inside"),
        dated("333", "2023-12-31 23:59", "Old"),
      ],
      { nextHref: NEXT_URL },
    );

    render(data);

    expect(host.querySelectorAll(".card")).toHaveLength(2);
    expect(host.textContent).toContain("Newest");
    expect(host.textContent).toContain("Inside");
    expect(host.textContent).not.toContain("Old");

    const summary = host.querySelector(".list-summary")?.textContent ?? "";
    expect(summary).toContain("2 shown");
    expect(summary).toContain("Approximate while filtered.");
    expect(summary).not.toContain("500");

    // The page crossed `since`, so there is nothing after it that the range can use.
    expect(host.querySelector(".pager-btn")).toBeNull();
  });

  test("carries the range onto the next-page link while inside the range", () => {
    const data = page(
      [dated("111", "2024-12-31 23:00", "Newest"), dated("222", "2024-06-01 09:00", "Inside")],
      { nextHref: NEXT_URL },
    );

    render(data);

    const next = host.querySelector<HTMLAnchorElement>(".pager a.pager-btn");
    expect(next?.textContent).toContain("Next");

    const href = new URL(next?.getAttribute("href") ?? "", BASE);
    expect(href.searchParams.get("p")).toBe("1");
    expect(href.searchParams.get("eh_since")).toBe("2024-01-01");
    expect(href.searchParams.get("eh_until")).toBe("2024-12-31");
  });

  test("leaves a range-free listing unchanged", () => {
    const url = `${BASE}?f_search=dogs`;
    const data = page(
      [
        dated("111", "2024-12-31 23:00", "Newest"),
        dated("222", "2024-06-01 09:00", "Inside"),
        dated("333", "2023-12-31 23:59", "Old"),
      ],
      { url, nextHref: NEXT_URL, resultText: "Found 500 results." },
    );

    render(data, url);

    expect(host.querySelectorAll(".card")).toHaveLength(3);
    expect(host.querySelector(".list-summary")?.textContent).toBe("Found 500 results.");
    expect(host.querySelector(".date-filter-note")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>(".pager a.pager-btn")?.getAttribute("href")).toBe(
      NEXT_URL,
    );
  });

  test("filters appended pages and stops paging after crossing since", async () => {
    updateSetting("listInfiniteScroll", true);
    const calls: string[] = [];
    const appended = [
      dated("222", "2024-05-01 10:00", "Inside next"),
      dated("333", "2023-12-31 10:00", "Before"),
    ];
    const data = page([dated("111", "2024-12-31 23:00", "Newest")], { nextHref: NEXT_URL });

    render(data, RANGE_URL, {
      pageSource: (url) => {
        calls.push(url);
        return Promise.resolve({
          items: appended,
          next: "https://e-hentai.org/?f_search=dogs&p=2",
        });
      },
    });

    expect(host.querySelectorAll(".card")).toHaveLength(1);
    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();

    expect(calls).toHaveLength(1);
    const requested = new URL(calls[0] ?? "", BASE);
    expect(requested.searchParams.get("eh_since")).toBe("2024-01-01");
    expect(requested.searchParams.get("eh_until")).toBe("2024-12-31");

    expect(host.querySelectorAll(".card")).toHaveLength(2);
    expect(host.textContent).toContain("Inside next");
    expect(host.textContent).not.toContain("Before");
    expect(host.querySelector(".list-summary")?.textContent).toContain("2 shown");

    // The fetched page crossed `since`, so the cursor is done: another intersection is a no-op.
    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();
    expect(calls).toHaveLength(1);

    updateSetting("listInfiniteScroll", false);
  });
});
