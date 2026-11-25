import { beforeEach, describe, expect, test } from "bun:test";

import { saveListFilters, setListPanelOpen } from "../../src/data/list-filters";
import { emptySearchQuery, parseSearchQuery } from "../../src/parse/query";
import { parseRoute } from "../../src/router";
import { createRouteViews } from "../../src/routes";
import type { ListRouteData, RouteOf, RouteViewFor } from "../../src/routes/types";
import { updateSetting } from "../../src/settings";
import type { ListItem, ListPageData } from "../../src/types";
import type { PageSource } from "../../src/ui/page-cursor";
import { renderList } from "../../src/views/list";
import { loadFixture } from "../dom";
import { installDom, mountHost, viewContext } from "./dom";
import { installTestObservers, lastObserver, settle } from "./observers";

const BASE = "https://e-hentai.org/";
const RANGE_URL = "https://e-hentai.org/?f_search=dogs&eh_since=2024-01-01&eh_until=2024-12-31";
const NEXT_URL = "https://e-hentai.org/?f_search=dogs&p=1";

let host: HTMLElement;
let navigations: string[];

interface RoutedList {
  route: RouteOf<"list">;
  data: ListRouteData;
  view: RouteViewFor<"list">;
}

/** A list fixture whose three rows carry `dates` and a configurable next link. */
async function listDocument({
  dates,
  nextHref = null,
}: {
  dates: Readonly<Record<string, string>>;
  nextHref?: string | null;
}): Promise<Document> {
  const doc = await loadFixture("list.html");
  const rows = [...doc.querySelectorAll<HTMLTableRowElement>("table.itg > tbody > tr")];
  // The fixture's second row repeats gid 111 and its fourth carries an invalid token; give the
  // duplicate a distinct, valid identity so three dated rows survive parsing.
  const duplicate = rows[1];
  if (duplicate !== undefined) {
    for (const link of duplicate.querySelectorAll<HTMLAnchorElement>('a[href*="/g/"]')) {
      link.setAttribute("href", "/g/444/dddddddddd/");
    }
  }
  for (const row of rows) {
    const href = row.querySelector<HTMLAnchorElement>("a.glink")?.getAttribute("href") ?? "";
    const gid = /\/g\/(\d+)\//.exec(href)?.[1];
    const posted = gid === undefined ? undefined : dates[gid];
    if (posted === undefined) {
      continue;
    }
    const cell = row.querySelector(".gl2c");
    if (cell === null) {
      continue;
    }
    const existing = row.querySelector<HTMLElement>(`#postedpop_${gid}`);
    if (existing !== null) {
      existing.textContent = posted;
      continue;
    }
    const node = doc.createElement("div");
    node.id = `postedpop_${gid}`;
    node.textContent = posted;
    cell.append(node);
  }
  const summary = doc.querySelector(".searchtext p");
  if (summary !== null) {
    summary.textContent = "Found 1,234 results.";
  }
  const next = doc.getElementById("dnext");
  if (next !== null) {
    if (nextHref === null) {
      next.remove();
    } else {
      next.setAttribute("href", nextHref);
    }
  }
  return doc;
}

function routedList(url: string, doc: Document, appended?: Document): RoutedList {
  const route = parseRoute(url, BASE);
  if (route.kind !== "list") {
    throw new Error(`expected a list route for ${url}`);
  }
  const views = createRouteViews({
    document: (requested) => Promise.resolve({ doc: appended ?? doc, url: requested }),
    viewerPage: () => Promise.reject(new Error("unexpected viewer load")),
    seedViewerPage: () => undefined,
  });
  return {
    route,
    data: views.routeView(route).parse(doc, route),
    view: views.routeView(route),
  };
}

function listSource(row: RoutedList): PageSource<ListItem> | undefined {
  // The route view's feed is widened to `unknown` items; this route is a list.
  return row.view.feed?.(row.route) as PageSource<ListItem> | undefined;
}

function pagerNext(): HTMLAnchorElement | null {
  return (
    [...host.querySelectorAll<HTMLAnchorElement>(".pager a.pager-btn")].find(
      (link) => link.textContent.trim() === "Next",
    ) ?? null
  );
}

function render(data: ListPageData, url = data.url, feed?: PageSource<ListItem>): void {
  const address = new URL(url);
  Object.assign(globalThis, { location: address });
  renderList(
    host,
    data,
    parseSearchQuery(address),
    viewContext({ navigate: (next) => navigations.push(next) }),
    "search",
    { pageSource: feed },
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
  test("renders the range fields and applies them through the filter form", async () => {
    const row = routedList(`${BASE}?f_search=dogs`, await listDocument({ dates: {} }));
    render(row.data.page, `${BASE}?f_search=dogs`);

    const form = host.querySelector<HTMLFormElement>("form.filters-grid");
    const since = host.querySelector<HTMLInputElement>('input[aria-label="Posted since"]');
    const until = host.querySelector<HTMLInputElement>('input[aria-label="Posted until"]');
    if (!form || !since || !until) {
      throw new Error("missing date range fields");
    }
    expect(since.getAttribute("type")).toBe("date");
    expect(until.getAttribute("type")).toBe("date");
    expect(since.getAttribute("title")).toContain("on or after");
    expect(until.getAttribute("title")).toContain("on or before");

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

  test("resets the range with the rest of the advanced filters", async () => {
    const row = routedList(RANGE_URL, await listDocument({ dates: {} }));
    render(row.data.page, RANGE_URL);

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

describe("posted-date range policy", () => {
  test("the list row bounds page one and ends paging after crossing since", async () => {
    const row = routedList(
      RANGE_URL,
      await listDocument({
        dates: {
          "111": "2024-12-31 23:00",
          "222": "2024-06-01 09:00",
          "444": "2023-12-31 23:59",
        },
        nextHref: NEXT_URL,
      }),
    );

    expect(row.data.page.items.map((item) => item.gid)).toEqual(["111", "222"]);
    expect(row.data.page.nextHref).toBeNull();

    render(row.data.page, row.data.page.url);

    expect(host.querySelectorAll(".card")).toHaveLength(2);
    expect(host.textContent).toContain("Alpha");
    expect(host.textContent).not.toContain("Alpha duplicate");

    const summary = host.querySelector(".list-summary")?.textContent ?? "";
    expect(summary).toContain("2 shown");
    expect(summary).toContain("Approximate while filtered.");
    expect(summary).not.toContain("1,234");

    expect(pagerNext()).toBeNull();
  });

  test("carries the range onto an in-range next link and passes range-free listings through", async () => {
    const dates = {
      "111": "2024-12-31 23:00",
      "222": "2024-06-01 09:00",
      "444": "2024-08-01 09:00",
    };
    const ranged = routedList(RANGE_URL, await listDocument({ dates, nextHref: NEXT_URL }));
    render(ranged.data.page, ranged.data.page.url);

    const next = pagerNext();
    expect(next?.textContent).toBe("Next");
    const href = new URL(next?.getAttribute("href") ?? "", BASE);
    expect(href.searchParams.get("p")).toBe("1");
    expect(href.searchParams.get("eh_since")).toBe("2024-01-01");
    expect(href.searchParams.get("eh_until")).toBe("2024-12-31");

    const plainUrl = `${BASE}?f_search=dogs`;
    const plain = routedList(
      plainUrl,
      await listDocument({
        dates: {
          "111": "2024-12-31 23:00",
          "222": "2024-06-01 09:00",
          "444": "2023-12-31 23:59",
        },
        nextHref: NEXT_URL,
      }),
    );
    render(plain.data.page, plainUrl);

    expect(host.querySelectorAll(".card")).toHaveLength(3);
    expect(host.querySelector(".list-summary")?.textContent).toBe("Found 1,234 results.");
    expect(host.querySelector(".date-filter-note")).toBeNull();
    expect(pagerNext()?.getAttribute("href")).toBe(NEXT_URL);
  });

  test("the list feed filters appended pages and stops after crossing since", async () => {
    updateSetting("listInfiniteScroll", true);
    const row = routedList(
      RANGE_URL,
      await listDocument({
        dates: { "111": "2024-12-31 23:00" },
        nextHref: NEXT_URL,
      }),
      await listDocument({
        dates: {
          "222": "2024-05-01 10:00",
          "444": "2023-12-31 10:00",
        },
        nextHref: "https://e-hentai.org/?f_search=dogs&p=2",
      }),
    );

    render(row.data.page, RANGE_URL, listSource(row));
    expect(host.querySelectorAll(".card")).toHaveLength(1);

    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();

    expect(host.querySelectorAll(".card")).toHaveLength(2);
    expect(host.textContent).toContain("Beta");
    expect(host.textContent).not.toContain("Alpha duplicate");
    expect(host.querySelector(".list-summary")?.textContent).toContain("2 shown");

    // The fetched page crossed `since`, so the cursor is done: another intersection is a no-op.
    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();

    updateSetting("listInfiniteScroll", false);
  });
});
