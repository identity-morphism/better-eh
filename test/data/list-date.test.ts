import { describe, expect, test } from "bun:test";

import {
  filterByDateRange,
  isDateRangeActive,
  isValidDate,
  listRequestUrl,
  postedDate,
  withDateRange,
} from "../../src/data/list-date";
import type { DateRange } from "../../src/data/list-date";

const RANGE: DateRange = { since: "2024-01-01", until: "2024-12-31" };

function param(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

describe("posted-date ranges", () => {
  test("accepts only real YYYY-MM-DD calendar days", () => {
    expect(isValidDate("2024-01-01")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2000-02-29")).toBe(true);

    expect(isValidDate("2023-02-29")).toBe(false);
    expect(isValidDate("2024-04-31")).toBe(false);
    expect(isValidDate("2024-13-01")).toBe(false);
    expect(isValidDate("2024-1-01")).toBe(false);
    expect(isValidDate("2024-01-01x")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });

  test("reads the day prefix from a posted timestamp, independent of time zone", () => {
    expect(postedDate("2024-01-01 12:00")).toBe("2024-01-01");
    expect(postedDate("2024-01-01")).toBe("2024-01-01");
    expect(postedDate(" 2024-01-01 00:00")).toBe("2024-01-01");
    expect(postedDate("2024-02-30 12:00")).toBeNull();
    expect(postedDate("01/01/2024")).toBeNull();
    expect(postedDate("")).toBeNull();
  });

  test("detects whether either bound is valid", () => {
    expect(isDateRangeActive(RANGE)).toBe(true);
    expect(isDateRangeActive({ since: "2024-01-01", until: "" })).toBe(true);
    expect(isDateRangeActive({ since: "", until: "2024-12-31" })).toBe(true);
    expect(isDateRangeActive({ since: "", until: "" })).toBe(false);
  });
});

describe("filterByDateRange", () => {
  const items = [
    { id: "newer", posted: "2024-12-31 23:00" },
    { id: "until", posted: "2024-12-31 00:01" },
    { id: "inside", posted: "2024-06-01 09:00" },
    { id: "since", posted: "2024-01-01 00:00" },
    { id: "older", posted: "2023-12-31 23:59" },
    { id: "unknown", posted: "" },
  ];

  test("keeps both inclusive bounds and reports the since boundary", () => {
    const result = filterByDateRange(items, RANGE);

    expect(result.items.map((item) => item.id)).toEqual(["newer", "until", "inside", "since"]);
    expect(result.crossedSince).toBe(true);
  });

  test("supports one-sided bounds", () => {
    const sinceOnly = filterByDateRange(items, { since: "2024-01-01", until: "" });
    expect(sinceOnly.items.map((item) => item.id)).toEqual(["newer", "until", "inside", "since"]);
    expect(sinceOnly.crossedSince).toBe(true);

    const untilOnly = filterByDateRange(items, { since: "", until: "2024-06-01" });
    expect(untilOnly.items.map((item) => item.id)).toEqual(["inside", "since", "older"]);
    expect(untilOnly.crossedSince).toBe(false);
  });

  test("returns every item unchanged for an inactive range", () => {
    const result = filterByDateRange(items, { since: "", until: "" });

    expect(result.items).toEqual(items);
    expect(result.crossedSince).toBe(false);
  });
});

describe("withDateRange", () => {
  test("carries both bounds onto a cursor link without dropping site filters", () => {
    const next = "https://e-hentai.org/?f_search=dogs&p=1";
    const wrapped = withDateRange(next, RANGE);

    expect(param(wrapped, "f_search")).toBe("dogs");
    expect(param(wrapped, "p")).toBe("1");
    expect(param(wrapped, "eh_since")).toBe("2024-01-01");
    expect(param(wrapped, "eh_until")).toBe("2024-12-31");
  });

  test("sets one bound and removes a stale copy of the other", () => {
    const wrapped = withDateRange("https://e-hentai.org/?eh_until=2020-01-01&p=2", {
      since: "2024-01-01",
      until: "",
    });

    expect(param(wrapped, "eh_since")).toBe("2024-01-01");
    expect(param(wrapped, "eh_until")).toBeNull();
    expect(param(wrapped, "p")).toBe("2");
  });
});

describe("listRequestUrl", () => {
  test("starts the site's cursor at the until day", () => {
    const url = "https://e-hentai.org/?f_search=dogs&eh_since=2024-01-01&eh_until=2024-12-31";

    const request = listRequestUrl(url);

    expect(param(request, "seek")).toBe("2024-12-31");
    expect(param(request, "f_search")).toBe("dogs");
    expect(param(request, "eh_since")).toBe("2024-01-01");
    expect(param(request, "eh_until")).toBe("2024-12-31");
  });

  test("never replaces an existing seek cursor", () => {
    const url = "https://e-hentai.org/?eh_until=2024-12-31&seek=2020-06-15";

    expect(listRequestUrl(url)).toBe(url);
  });

  test("leaves addresses without a valid until day alone", () => {
    const bare = "https://e-hentai.org/?f_search=dogs";
    expect(listRequestUrl(bare)).toBe(bare);

    const sinceOnly = "https://e-hentai.org/?eh_since=2024-01-01";
    expect(listRequestUrl(sinceOnly)).toBe(sinceOnly);

    const invalid = "https://e-hentai.org/?eh_until=2024-02-30&advsearch=1";
    expect(listRequestUrl(invalid)).toBe(invalid);
  });
});
