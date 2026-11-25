import { beforeEach, describe, expect, test } from "bun:test";

import type { TorrentInfo } from "../../src/data/gallery-torrents";
import type { GalleryTorrentsPage } from "../../src/parse/gallery-torrents";
import { parseGalleryTorrents } from "../../src/parse/gallery-torrents";
import { renderGalleryTorrents } from "../../src/views/gallery-torrents";
import { loadFixture } from "../dom";
import { until } from "./async";
import { installDom, mountHost, requireNode, viewContext } from "./dom";

const PAGE_URL = "https://e-hentai.org/gallerytorrents.php?gid=987654&t=abcdef1234";

const INFO: TorrentInfo = {
  name: "Test Gallery.zip",
  posted: "2024-01-01 12:00",
  size: "10.50 MiB",
  seeds: 12,
  peers: 2,
  completes: 40,
  uploader: "TestUploader",
  personalizedHref: "https://ehtracker.org/get/987654/aaaa/personalized.torrent",
  redistributableHref: "https://ehtracker.org/get/987654/aaaa/redistributable.torrent",
  comments: "A test comment for this torrent.",
};

interface LoadCall {
  pageUrl: string;
  gtid: string;
  signal: AbortSignal;
}

describe("gallery torrents view", () => {
  let host: HTMLElement;
  let data: GalleryTorrentsPage;
  let calls: LoadCall[];

  const loader = (info: TorrentInfo) => {
    return (pageUrl: string, gtid: string, signal: AbortSignal): Promise<TorrentInfo> => {
      calls.push({ pageUrl, gtid, signal });
      return Promise.resolve(info);
    };
  };

  function render(
    loadInfo: (pageUrl: string, gtid: string, signal: AbortSignal) => Promise<TorrentInfo>,
  ): AbortSignal {
    const ctx = viewContext({
      signal: new AbortController().signal,
    });
    renderGalleryTorrents(host, data, ctx, { loadInfo });
    return ctx.signal;
  }

  beforeEach(async () => {
    const document = installDom(PAGE_URL);
    const fixture = await loadFixture("gallerytorrents.html");
    data = parseGalleryTorrents(fixture, PAGE_URL);
    host = mountHost(document);
    calls = [];
  });

  test("renders the count, the heading and one card per torrent", () => {
    render(loader(INFO));

    expect(host.querySelector(".list-summary")?.textContent).toBe("2 torrents");
    expect(host.querySelector(".list-heading h1")?.textContent).toBe("Test Gallery");

    const cards = host.querySelectorAll(".gallery-torrent-card");
    expect(cards).toHaveLength(2);

    const first = requireNode<HTMLElement>(host, ".gallery-torrent-card");
    const name = requireNode<HTMLAnchorElement>(first, ".gallery-torrent-name");
    expect(name.textContent).toBe("Test Gallery.zip");
    expect(name.getAttribute("href")).toBe(
      "https://ehtracker.org/get/987654/aaaaaaaaaaaa1111/bbbbbbbbbbbb2222cccccccccccc3333.torrent",
    );

    const meta = first.querySelector(".gallery-torrent-meta")?.textContent ?? "";
    expect(meta).toContain("Posted2024-01-01 12:00");
    expect(meta).toContain("Size10.50 MiB");
    expect(meta).toContain("Seeds12");
    expect(meta).toContain("Peers2");
    expect(meta).toContain("Downloads40");
    expect(meta).toContain("UploaderTestUploader");

    expect(host.querySelectorAll(".gallery-torrent-details-button")).toHaveLength(2);
  });

  test("loads and shows details inline without a native window", async () => {
    const signal = render(loader(INFO));
    const card = requireNode<HTMLElement>(host, ".gallery-torrent-card");
    const button = requireNode<HTMLButtonElement>(card, ".gallery-torrent-details-button");

    button.click();

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.disabled).toBe(true);

    await until(() => card.querySelector(".gallery-torrent-info") !== null, 50);

    expect(calls).toEqual([{ pageUrl: PAGE_URL, gtid: "1001", signal }]);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Hide details");

    const details = requireNode(card, ".gallery-torrent-details");
    expect(details.textContent).toContain("Personalized torrent");
    expect(details.textContent).toContain("Redistributable torrent");
    expect(details.textContent).toContain("A test comment for this torrent.");

    const links = [...details.querySelectorAll<HTMLAnchorElement>(".gallery-torrent-info-link")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      INFO.personalizedHref,
      INFO.redistributableHref,
    ]);
  });

  test("shows a loader failure inline and keeps the page usable", async () => {
    render(() => Promise.reject(new Error("Tracker unavailable")));
    const card = requireNode<HTMLElement>(host, ".gallery-torrent-card");

    requireNode<HTMLButtonElement>(card, ".gallery-torrent-details-button").click();

    await until(() => card.querySelector(".gallery-torrent-error") !== null, 50);
    expect(requireNode(card, ".gallery-torrent-error").textContent).toBe("Tracker unavailable");
    expect(requireNode<HTMLButtonElement>(card, ".gallery-torrent-details-button").disabled).toBe(
      false,
    );
  });

  test("an empty list keeps the back link and offers the native page", () => {
    data = { ...data, torrents: [] };
    render(loader(INFO));

    expect(host.querySelectorAll(".gallery-torrent-card")).toHaveLength(0);
    expect(host.querySelector(".empty-state")?.textContent).toContain(
      "No torrents were found for this gallery.",
    );
    const native = requireNode<HTMLAnchorElement>(host, ".empty-state a[data-native]");
    expect(native.getAttribute("href")).toContain("eh_native=1");
    expect(requireNode<HTMLAnchorElement>(host, ".gallery-torrents-back")).not.toBeNull();
  });
});
