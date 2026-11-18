import { beforeEach, describe, expect, test } from "bun:test";

import { applyPersistedListFilters, saveListFilters } from "../../src/data/list-filters";
import { emptySearchQuery } from "../../src/parse/query";
import type { Route } from "../../src/router";
import { parseRoute } from "../../src/router";

function listing(url = "https://e-hentai.org/"): Route {
  const route = parseRoute(url);
  if (route.kind !== "list") {
    throw new Error(`expected a list route for ${url}`);
  }
  return route;
}

function search(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

beforeEach(() => {
  Object.assign(globalThis, { location: new URL("https://e-hentai.org/") });
  saveListFilters(emptySearchQuery());
});

describe("remembered listing filters", () => {
  test("adds categories and advanced filters to a bare listing", () => {
    saveListFilters({
      ...emptySearchQuery(),
      cats: 6,
      rating: 4,
      expunged: true,
      pageFrom: "10",
      disableTags: true,
    });

    const url = applyPersistedListFilters(listing()).url;

    expect(search(url, "f_cats")).toBe("6");
    expect(search(url, "f_srdd")).toBe("4");
    expect(search(url, "f_sh")).toBe("on");
    expect(search(url, "f_spf")).toBe("10");
    expect(search(url, "f_sft")).toBe("on");
    expect(search(url, "advsearch")).toBe("1");
  });

  test("adds a remembered posted-date range to a bare listing", () => {
    saveListFilters({
      ...emptySearchQuery(),
      since: "2024-01-01",
      until: "2024-12-31",
    });

    const url = applyPersistedListFilters(listing()).url;

    expect(search(url, "eh_since")).toBe("2024-01-01");
    expect(search(url, "eh_until")).toBe("2024-12-31");
    expect(search(url, "advsearch")).toBe("1");
  });

  test("keeps an address that already chose its own posted-date range", () => {
    saveListFilters({ ...emptySearchQuery(), since: "2020-01-01", until: "2020-12-31" });

    const explicit = "https://e-hentai.org/?eh_since=2024-01-01&eh_until=2024-12-31";
    expect(applyPersistedListFilters(listing(explicit)).url).toBe(explicit);
  });

  test("keeps an address that chose its own filters", () => {
    saveListFilters({ ...emptySearchQuery(), cats: 6, rating: 5 });

    const explicit = "https://e-hentai.org/?f_search=cat&f_srdd=2";
    expect(applyPersistedListFilters(listing(explicit)).url).toBe(explicit);

    const category = "https://e-hentai.org/doujinshi";
    expect(applyPersistedListFilters(listing(category)).url).toBe(category);
  });

  test("leaves scopes the site does not filter the same way alone", () => {
    saveListFilters({ ...emptySearchQuery(), cats: 6 });

    const popular = "https://e-hentai.org/popular";
    expect(applyPersistedListFilters(listing(popular)).url).toBe(popular);
  });

  test("carries remembered filters onto tag and uploader pages", () => {
    saveListFilters({ ...emptySearchQuery(), cats: 2 });

    const tag = applyPersistedListFilters(listing("https://e-hentai.org/tag/doujinshi:test")).url;
    expect(search(tag, "f_cats")).toBe("2");

    const uploader = applyPersistedListFilters(
      listing("https://e-hentai.org/uploader/someone"),
    ).url;
    expect(search(uploader, "f_cats")).toBe("2");
  });

  test("does nothing until the user has chosen a filter", () => {
    const bare = "https://e-hentai.org/";
    expect(applyPersistedListFilters(listing(bare)).url).toBe(bare);
  });
});
