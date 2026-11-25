import { beforeEach, describe, expect, test } from "bun:test";

import type {
  ToplistCategory,
  ToplistEntry,
  ToplistOverview,
  ToplistTab,
} from "../../src/parse/toplist";
import { renderToplist } from "../../src/views/toplist";
import { installDom, viewContext } from "./dom";

function tab(tl: string, label: string, group: string, active = false): ToplistTab {
  return { label, href: `https://e-hentai.org/toplist.php?tl=${tl}`, group, active };
}

function entry(
  rank: number,
  label: string,
  href: string,
  overrides: Partial<ToplistEntry> = {},
): ToplistEntry {
  return {
    rank,
    label,
    href,
    gid: null,
    score: null,
    uploader: null,
    uploaderHref: null,
    posted: "",
    pages: null,
    category: null,
    torrentsHref: null,
    ...overrides,
  };
}

function gallery(
  rank: number,
  label: string,
  gid: string,
  token: string,
  overrides: Partial<ToplistEntry> = {},
): ToplistEntry {
  return entry(rank, label, `https://e-hentai.org/g/${gid}/${token}/`, {
    gid,
    ...overrides,
  });
}

const OVERVIEW: ToplistOverview = {
  kind: "overview",
  tabs: [
    tab("11", "Galleries", "All-Time", true),
    tab("12", "Galleries", "Past Year"),
    tab("22", "Uploader", "Past Year"),
  ],
  sections: [
    {
      title: "Galleries All-Time",
      entries: [
        gallery(1, "Shapeshifter Part 1-3", "596447", "3894f02c20"),
        gallery(2, "GAME OVER", "508505", "6b3c6730f0"),
        gallery(4, "Unranked Gallery", "2030622", "1524b37ea2"),
      ],
    },
    {
      title: "Uploader Past Year",
      entries: [
        entry(1, "dune1998", "https://e-hentai.org/uploader/dune1998"),
        entry(2, "Zero Angel", "https://e-hentai.org/uploader/Zero+Angel"),
        entry(3, "Kungs0919", "https://e-hentai.org/uploader/Kungs0919"),
      ],
    },
  ],
};

const CATEGORY: ToplistCategory = {
  kind: "category",
  url: "https://e-hentai.org/toplist.php?tl=11",
  tabs: [tab("11", "Galleries", "All-Time", true), tab("12", "Galleries", "Past Year")],
  title: "Galleries All-Time",
  entries: [
    gallery(1, "Shapeshifter Part 1-3", "596447", "3894f02c20", { score: "158,388,517" }),
    gallery(2, "GAME OVER", "508505", "6b3c6730f0", { score: "143,233,600" }),
  ],
  pager: {
    page: 2,
    pages: 200,
    prevHref: "https://e-hentai.org/toplist.php?tl=11",
    nextHref: "https://e-hentai.org/toplist.php?tl=11&p=2",
  },
};

function render(data: ToplistOverview | ToplistCategory): HTMLElement {
  const host = document.createElement("div");
  renderToplist(host, data, viewContext());
  return host;
}

beforeEach(() => {
  installDom();
});

describe("renderToplist overview", () => {
  test("renders one link per tab inside its period group and marks the active one", () => {
    const host = render(OVERVIEW);

    const tabs = [...host.querySelectorAll<HTMLAnchorElement>(".toplist-tab")];
    expect(tabs.map((node) => node.textContent)).toEqual(["Galleries", "Galleries", "Uploader"]);
    expect(tabs.map((node) => node.getAttribute("href"))).toEqual([
      "https://e-hentai.org/toplist.php?tl=11",
      "https://e-hentai.org/toplist.php?tl=12",
      "https://e-hentai.org/toplist.php?tl=22",
    ]);

    const groups = [...host.querySelectorAll(".toplist-tab-group")];
    expect(groups.map((group) => group.querySelector("h2")?.textContent)).toEqual([
      "All-Time",
      "Past Year",
    ]);
    expect(groups[0]?.querySelectorAll(".toplist-tab").length).toBe(1);
    expect(groups[1]?.querySelectorAll(".toplist-tab").length).toBe(2);

    const active = host.querySelectorAll<HTMLAnchorElement>(".toplist-tab.is-active");
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toBe("Galleries");
    expect(active[0]?.getAttribute("aria-current")).toBe("page");
  });

  test("renders every section with ranked rows and gallery links", () => {
    const host = render(OVERVIEW);

    const sections = [...host.querySelectorAll(".toplist-section")];
    expect(sections.map((section) => section.querySelector("h2")?.textContent)).toEqual([
      "Galleries All-Time",
      "Uploader Past Year",
    ]);
    expect(sections.map((section) => section.querySelectorAll(".toplist-row").length)).toEqual([
      3, 3,
    ]);

    expect([...host.querySelectorAll(".toplist-rank")].map((badge) => badge.textContent)).toEqual([
      "#1",
      "#2",
      "#4",
      "#1",
      "#2",
      "#3",
    ]);
    expect([...host.querySelectorAll(".toplist-label")].map((label) => label.textContent)).toEqual([
      "Shapeshifter Part 1-3",
      "GAME OVER",
      "Unranked Gallery",
      "dune1998",
      "Zero Angel",
      "Kungs0919",
    ]);

    const galleryRows = [...host.querySelectorAll(".toplist-row.is-gallery")];
    expect(galleryRows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
      "https://e-hentai.org/g/596447/3894f02c20/",
      "https://e-hentai.org/g/508505/6b3c6730f0/",
      "https://e-hentai.org/g/2030622/1524b37ea2/",
    ]);
    const uploaderRows = sections[1]?.querySelectorAll(".toplist-row") ?? [];
    expect([...uploaderRows].every((row) => !row.classList.contains("is-gallery"))).toBe(true);
  });

  test("adds an in-page jump list once the overview has enough blocks", () => {
    const sections = Array.from({ length: 4 }, (_, index) => ({
      title: `Block ${index + 1}`,
      entries: OVERVIEW.sections[0]?.entries ?? [],
    }));
    const host = render({ ...OVERVIEW, sections });

    const links = [...host.querySelectorAll<HTMLAnchorElement>(".toplist-jump a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "Block 1",
      "Block 2",
      "Block 3",
      "Block 4",
    ]);
    expect(links[0]?.getAttribute("href")).toBe("#toplist-section-0");
    expect(host.querySelector("#toplist-section-3 .toplist-section-title")?.textContent).toBe(
      "Block 4",
    );
    expect(host.querySelector(".toplist-section")?.getAttribute("aria-label")).toBe("Block 1");
  });

  test("falls back to an empty state when the page has no sections", () => {
    const host = render({ kind: "overview", tabs: [], sections: [] });

    expect(host.querySelector(".empty-state")?.textContent).toContain(
      "No toplists were found on this page.",
    );
    expect(host.querySelector(".empty-state a")?.getAttribute("href")).toContain("eh_native=1");
  });
});

describe("renderToplist category", () => {
  test("heads the page with the category title and its page position", () => {
    const host = render(CATEGORY);

    expect(host.querySelector("h1")?.textContent).toBe("Galleries All-Time");
    expect(host.querySelector(".list-summary")?.textContent).toBe("2 ranked entries");
    expect(host.querySelector(".toplist-tab.is-active")?.textContent).toBe("Galleries");
  });

  test("renders ranked rows with their scores and the numeric pager", () => {
    const host = render(CATEGORY);

    const rows = [...host.querySelectorAll(".toplist-row")];
    expect(rows.map((row) => row.querySelector(".toplist-rank")?.textContent)).toEqual([
      "#1",
      "#2",
    ]);
    expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
      "https://e-hentai.org/g/596447/3894f02c20/",
      "https://e-hentai.org/g/508505/6b3c6730f0/",
    ]);
    expect(rows.map((row) => row.querySelector(".toplist-score")?.textContent)).toEqual([
      "158,388,517",
      "143,233,600",
    ]);

    const nav = host.querySelector(".pager");
    expect(nav?.getAttribute("aria-label")).toBe("Toplist pages");
    expect(nav?.querySelector(".pager-info")?.textContent).toBe("Page 2 of 200");
    expect(
      [...(nav?.querySelectorAll("a.pager-num") ?? [])].map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://e-hentai.org/toplist.php?tl=11",
      "https://e-hentai.org/toplist.php?tl=11&p=2",
      "https://e-hentai.org/toplist.php?tl=11&p=199",
    ]);
  });
});
