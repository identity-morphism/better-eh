import { describe, expect, test } from "bun:test";

import { parseTorrents } from "../../src/parse/torrents";
import { loadFixture, parseDocument } from "../dom";

const TORRENTS_URL = "https://e-hentai.org/torrents.php?s=seeded&u=4689964";

const doc = await loadFixture("torrents.html");
const data = parseTorrents(doc, TORRENTS_URL);

describe("parseTorrents", () => {
  test("reads the filters from the URL", () => {
    expect(data.status).toBe("seeded");
    expect(data.uploaderFilter).toBe("4689964");
    expect(data.search).toBe("");

    const plain = parseTorrents(doc, "https://e-hentai.org/torrents.php");
    expect(plain.status).toBe("all");
    expect(plain.uploaderFilter).toBeNull();

    expect(
      parseTorrents(doc, "https://e-hentai.org/torrents.php?search=elf&u=42").uploaderFilter,
    ).toBe("42");
    expect(parseTorrents(doc, "https://e-hentai.org/torrents.php?search=elf").search).toBe("elf");

    expect(parseTorrents(doc, "https://e-hentai.org/torrents.php?s=unseeded").status).toBe(
      "unseeded",
    );
    expect(parseTorrents(doc, "https://e-hentai.org/torrents.php?s=bogus").status).toBe("all");
  });

  test("reads the summary", () => {
    expect(data.summary).toBe("Showing 1-3 of 964,330");
  });

  test("turns the zero-based page parameter into a displayed page", () => {
    expect(data.page).toBe(1);
    expect(parseTorrents(doc, "https://e-hentai.org/torrents.php?page=2").page).toBe(3);
    expect(parseTorrents(doc, "https://e-hentai.org/torrents.php?page=nope").page).toBe(1);
  });

  test("reads the numeric strip and the arrow links from the pager", () => {
    expect(data.pages).toEqual([1, 2, 3, 100]);
    expect(data.nextHref).toBe("https://e-hentai.org/torrents.php?page=1");
    expect(data.prevHref).toBeNull();
  });

  test("parses every row field", () => {
    expect(data.rows).toHaveLength(3);
    expect(data.rows[0]).toEqual({
      gid: "4281155",
      name: "[TKSpower (Zekkyo)] Itteki demo Osake o Nomu to H ni Nacchau Otonari no Minami-san.zip",
      torrentHref: "https://e-hentai.org/gallerytorrents.php?gid=4281155&t=7decb991ec&gtid=2290242",
      galleryHref: "https://e-hentai.org/g/4281155/7decb991ec/",
      size: "92.56 MiB",
      seeds: 1,
      peers: 0,
      downloads: 0,
      uploader: "Konazumi",
      uploaderHref: "https://e-hentai.org/torrents.php?u=230357",
      added: "2026-10-25 14:24",
    });
    expect(data.rows[1]).toEqual({
      gid: "4281137",
      name: "[Midorikawa Pest] Sake wa Nondemo Nomareruna [English].zip",
      torrentHref: "https://e-hentai.org/gallerytorrents.php?gid=4281137&t=1c8a7ace88&gtid=2290241",
      galleryHref: "https://e-hentai.org/g/4281137/1c8a7ace88/",
      size: "9.05 MiB",
      seeds: 0,
      peers: 1,
      downloads: 2,
      uploader: "Bowden",
      uploaderHref: "https://e-hentai.org/torrents.php?u=399592",
      added: "2026-10-25 14:23",
    });
    expect(data.rows[2]?.gid).toBe("4280579");
    expect(data.rows[2]?.downloads).toBe(3);
  });

  test("falls back to the row id when the gallery link is missing", () => {
    const row = parseTorrents(
      parseDocument(`
        <table class="itg"><tr id="777">
          <td class="itd">2026-01-01 00:00</td>
          <td class="itd">Bare torrent</td>
          <td class="itd">—</td>
          <td class="itd">1 MiB</td>
          <td class="itd">4</td>
          <td class="itd">5</td>
          <td class="itd">6</td>
          <td class="itd">alice</td>
        </tr></table>
      `),
      "https://e-hentai.org/torrents.php",
    );

    expect(row.rows[0]).toMatchObject({
      gid: "777",
      galleryHref: null,
      seeds: 4,
      peers: 5,
      downloads: 6,
      uploader: "alice",
      uploaderHref: null,
    });
  });
});
