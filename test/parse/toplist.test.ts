import { describe, expect, test } from "bun:test";

import { parseToplist } from "../../src/parse/toplist";
import { loadFixture } from "../dom";

const TOPLIST_URL = "https://e-hentai.org/toplist.php";

const overviewDoc = await loadFixture("toplist.html");
const overview = parseToplist(overviewDoc, TOPLIST_URL);
const activeOverview = parseToplist(overviewDoc, `${TOPLIST_URL}?tl=22`);

const categoryDoc = await loadFixture("toplist-category.html");
const category = parseToplist(categoryDoc, `${TOPLIST_URL}?tl=11`);

const usersDoc = await loadFixture("toplist-category-users.html");
const users = parseToplist(usersDoc, `${TOPLIST_URL}?tl=21`);

describe("parseToplist overview", () => {
  test("collects one tab per toplist link and marks the requested one", () => {
    expect(overview.kind).toBe("overview");
    expect(overview.tabs).toEqual([
      {
        label: "Galleries",
        href: "https://e-hentai.org/toplist.php?tl=11",
        group: "All-Time",
        active: false,
      },
      {
        label: "Uploader",
        href: "https://e-hentai.org/toplist.php?tl=22",
        group: "Past Year",
        active: false,
      },
    ]);
    expect(activeOverview.tabs.map((tab) => tab.active)).toEqual([false, true]);
  });

  test("parses each block as a titled section", () => {
    if (overview.kind !== "overview") {
      throw new Error("expected the overview shape");
    }
    expect(overview.sections.map((section) => section.title)).toEqual([
      "Galleries All-Time",
      "Uploader Past Year",
    ]);
    expect(overview.sections.map((section) => section.entries.length)).toEqual([3, 3]);
  });

  test("exposes gid for gallery rows and leaves it empty for user rows", () => {
    if (overview.kind !== "overview") {
      throw new Error("expected the overview shape");
    }
    expect(overview.sections[0]?.entries).toMatchObject([
      {
        rank: 1,
        label: "Shapeshifter Part 1-3",
        href: "https://e-hentai.org/g/596447/3894f02c20/",
        gid: "596447",
        score: null,
      },
      {
        rank: 2,
        label: "[保安] 火影忍者之无限欲望",
        href: "https://e-hentai.org/g/2030622/1524b37ea2/",
        gid: "2030622",
        score: null,
      },
      {
        rank: 3,
        label: "GAME OVER",
        href: "https://e-hentai.org/g/508505/6b3c6730f0/",
        gid: "508505",
        score: null,
      },
    ]);
    expect(overview.sections[1]?.entries).toMatchObject([
      {
        rank: 1,
        label: "dune1998",
        href: "https://e-hentai.org/uploader/dune1998",
        gid: null,
        score: null,
      },
      {
        rank: 2,
        label: "Zero Angel",
        href: "https://e-hentai.org/uploader/Zero+Angel",
        gid: null,
        score: null,
      },
      {
        rank: 3,
        label: "Kungs0919",
        href: "https://e-hentai.org/uploader/Kungs0919",
        gid: null,
        score: null,
      },
    ]);
  });

  test("returns empty data when the page has no toplist blocks", async () => {
    const doc = await loadFixture("toplist.html");
    doc.querySelector(".ido")?.replaceChildren();

    expect(parseToplist(doc, TOPLIST_URL)).toEqual({
      kind: "overview",
      tabs: [],
      sections: [],
    });
  });
});

describe("parseToplist category", () => {
  test("reads the category title and pagination from a gallery list", () => {
    if (category.kind !== "category") {
      throw new Error("expected the category shape");
    }
    expect(category.title).toBe("Galleries All-Time");
    expect(category.pager).toEqual({
      page: 1,
      pages: 3,
      prevHref: null,
      nextHref: "https://e-hentai.org/toplist.php?tl=11&p=1",
    });
  });

  test("ranks gallery rows and keeps their gallery identity and view count", () => {
    if (category.kind !== "category") {
      throw new Error("expected the category shape");
    }
    expect(category.entries).toMatchObject([
      {
        rank: 1,
        label: "Shapeshifter Part 1-3",
        href: "https://e-hentai.org/g/596447/3894f02c20/",
        gid: "596447",
        score: "158,388,517",
        posted: "2013-05-27 07:47",
        pages: 345,
        category: { name: "Western", cls: "cta" },
      },
      {
        rank: 2,
        label: "火影忍者之无限欲望",
        href: "https://e-hentai.org/g/2030622/1524b37ea2/",
        gid: "2030622",
        score: "143,233,600",
        posted: "2021-10-31 12:00",
        pages: 88,
        category: null,
      },
    ]);
  });

  test("supplies the full tab catalogue on a category page", () => {
    expect(category.tabs).toHaveLength(28);
    expect(category.tabs[0]).toEqual({
      label: "Galleries",
      href: "https://e-hentai.org/toplist.php?tl=11",
      group: "All-Time",
      active: true,
    });
    expect(category.tabs.filter((tab) => tab.active)).toHaveLength(1);
    expect(category.tabs.find((tab) => tab.href.endsWith("tl=21"))).toMatchObject({
      label: "Uploader",
      group: "All-Time",
    });
  });

  test("parses user rows in rank order with their scores", () => {
    if (users.kind !== "category") {
      throw new Error("expected the category shape");
    }
    expect(users.title).toBe("Uploader All-Time");
    expect(users.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(users.entries.map((entry) => entry.label)).toEqual([
      "114514beastman",
      "KEYLUN",
      "qq3870990",
      "Goukenimaru",
    ]);
    expect(users.entries.map((entry) => entry.score)).toEqual([
      "13,822,240,373",
      "13,646,410,325",
      "12,908,217,602",
      "11,874,331,004",
    ]);
    expect(users.entries.every((entry) => entry.gid === null)).toBe(true);
    expect(users.entries[2]?.href).toBe("https://e-hentai.org/uploader/qq3870990");
    expect(users.pager?.pages).toBe(2);
  });
});
