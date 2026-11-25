import { beforeEach, describe, expect, test } from "bun:test";

import type { TorrentPage } from "../../src/parse/torrents";
import { parseTorrents } from "../../src/parse/torrents";
import { renderTorrents } from "../../src/views/torrents";
import { loadFixture } from "../dom";
import { installDom, mountHost, requireNode, viewContext } from "./dom";

const BASE_URL = "https://e-hentai.org/torrents.php?search=elf&o=sd";
const MEMBER_ID = "4689964";

function fire(node: Element, type: string): void {
  node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
}

function statusButton(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button.torrent-filter-btn")].find(
    (node) => node.textContent === text,
  );
  if (!button) {
    throw new Error(`missing status button ${text}`);
  }
  return button;
}

describe("torrents view", () => {
  let host: HTMLElement;
  let fixture: Document;
  let data: TorrentPage;
  let navigations: string[];

  const recordNavigation = (url: string): void => {
    navigations.push(url);
  };

  beforeEach(async () => {
    const document = installDom(BASE_URL);
    document.cookie = `ipb_member_id=${MEMBER_ID}; path=/`;

    fixture = await loadFixture("torrents.html");
    data = parseTorrents(fixture, BASE_URL);
    host = mountHost(document);
    navigations = [];
    renderTorrents(host, data, viewContext({ navigate: recordNavigation }));
  });

  test("renders one row per torrent with labelled numeric cells and gallery links", () => {
    const rows = host.querySelectorAll("tbody tr.torrent-row");
    expect(rows).toHaveLength(3);

    const first = rows[0];
    expect(first?.querySelector(".torrent-name-text")?.textContent).toContain("TKSpower");
    expect(first?.querySelector(".torrent-seeds")?.textContent).toBe("1");
    expect(first?.querySelector(".torrent-peers")?.textContent).toBe("0");
    expect(first?.querySelector(".torrent-downloads")?.textContent).toBe("0");

    const size = requireNode<HTMLElement>(host, ".torrent-row .torrent-size");
    const seeds = requireNode<HTMLElement>(host, ".torrent-row .torrent-seeds");
    expect(size.getAttribute("aria-label")).toMatch(/^Size: /);
    expect(seeds.getAttribute("aria-label")).toMatch(/^Seeds: /);

    expect(
      first?.querySelector<HTMLAnchorElement>(".torrent-gallery a")?.getAttribute("href"),
    ).toBe("https://e-hentai.org/g/4281155/7decb991ec/");
    expect(
      first?.querySelector<HTMLAnchorElement>(".torrent-uploader a")?.getAttribute("href"),
    ).toBe("https://e-hentai.org/torrents.php?u=230357");
  });

  test("status filters navigate with the site's own parameter from the parsed page URL", () => {
    expect(statusButton(host, "All").getAttribute("aria-pressed")).toBe("true");
    expect(statusButton(host, "Seeded").getAttribute("aria-pressed")).toBe("false");

    // The view keeps the parsed page URL, not the ambient address.
    Object.assign(globalThis, { location: new URL("https://e-hentai.org/elsewhere") });
    fire(statusButton(host, "Seeded"), "click");
    fire(statusButton(host, "Unseeded"), "click");
    fire(statusButton(host, "All"), "click");

    expect(navigations).toEqual([`${BASE_URL}&s=seeded`, `${BASE_URL}&s=unseeded`, BASE_URL]);

    const last = [...host.querySelectorAll<HTMLAnchorElement>("a.pager-num")].find(
      (link) => link.textContent === "100",
    );
    expect(last?.getAttribute("href")).toBe(`${BASE_URL}&page=99`);
  });

  test("the only-my toggle adds and removes the member id", () => {
    const input = requireNode<HTMLInputElement>(host, "input[type='checkbox']");
    expect(input.checked).toBe(false);

    input.checked = true;
    fire(input, "change");
    expect(navigations).toEqual([`${BASE_URL}&u=${MEMBER_ID}`]);

    const mineUrl = `https://e-hentai.org/torrents.php?search=elf&u=${MEMBER_ID}`;
    renderTorrents(
      host,
      parseTorrents(fixture, mineUrl),
      viewContext({ navigate: recordNavigation }),
    );

    const mine = requireNode<HTMLInputElement>(host, "input[type='checkbox']");
    expect(mine.checked).toBe(true);
    mine.checked = false;
    fire(mine, "change");
    expect(navigations.at(-1)).toBe("https://e-hentai.org/torrents.php?search=elf");
  });

  test("marks the current page and windows the strip around it", () => {
    renderTorrents(
      host,
      {
        ...data,
        page: 2,
        prevHref: "https://e-hentai.org/torrents.php?search=elf&o=sd",
        nextHref: "https://e-hentai.org/torrents.php?search=elf&o=sd&page=2",
      },
      viewContext({ navigate: recordNavigation }),
    );

    const current = requireNode<HTMLElement>(host, ".pager-num.is-current");
    expect(current.textContent).toBe("2 (current page)");

    const numberLinks = [...host.querySelectorAll<HTMLAnchorElement>("a.pager-num")];
    expect(numberLinks.map((link) => link.textContent)).toEqual(["1", "3", "100"]);
    expect(numberLinks[0]?.getAttribute("href")).toBe(BASE_URL);
    expect(host.querySelector("a.pager-btn")).toBeNull();
  });

  test("column headers sort through the site's own o parameter", () => {
    const links = [...host.querySelectorAll<HTMLAnchorElement>("th .torrent-sort")];
    expect(links.map((link) => link.textContent)).toEqual([
      "Added",
      "Size",
      "Seeds",
      "Peers",
      "DLs",
    ]);

    const byLabel = (label: string): HTMLAnchorElement => {
      const link = links.find((candidate) => candidate.textContent === label);
      if (!link) {
        throw new Error(`missing sort link ${label}`);
      }
      return link;
    };

    expect(byLabel("Seeds").getAttribute("href")).toBe(BASE_URL);
    expect(byLabel("Seeds").getAttribute("aria-current")).toBe("true");
    expect(byLabel("Size").getAttribute("href")).toBe(
      "https://e-hentai.org/torrents.php?search=elf&o=bd",
    );
    expect(byLabel("Added").getAttribute("href")).toBe(
      "https://e-hentai.org/torrents.php?search=elf",
    );
  });

  test("an empty index points at the native page", () => {
    renderTorrents(host, { ...data, rows: [] }, viewContext({ navigate: recordNavigation }));

    const empty = requireNode<HTMLElement>(host, ".empty-state");
    expect(empty.querySelector("p.state-text")?.textContent).toBe("No torrents match this filter.");
    const links = [...empty.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.textContent)).toEqual(["Clear filters", "Open native page"]);
    expect(links[0]?.getAttribute("href")).toBe("/torrents.php");
    expect(host.querySelector("table")).toBeNull();
  });
});
