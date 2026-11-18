import { describe, expect, test } from "bun:test";

import { parseTorrentInfo } from "../../src/data/gallery-torrents";
import { ParseMismatchError } from "../../src/fetch/errors";
import { parseGalleryTorrents } from "../../src/parse/gallery-torrents";
import { assertGalleryTorrentsPage } from "../../src/parse/sanity";
import { loadFixture, parseDocument } from "../dom";

const PAGE_URL = "https://e-hentai.org/gallerytorrents.php?gid=987654&t=abcdef1234";

const doc = await loadFixture("gallerytorrents.html");
const infoDoc = await loadFixture("gallerytorrents-info.html");

describe("parseGalleryTorrents", () => {
  const data = parseGalleryTorrents(doc, PAGE_URL);

  test("keeps the page address and gallery title", () => {
    expect(data.url).toBe(PAGE_URL);
    expect(data.title).toBe("Test Gallery");
  });

  test("builds the in-app gallery address from the query", () => {
    expect(data.galleryHref).toBe("/g/987654/abcdef1234/");
    expect(
      parseGalleryTorrents(doc, "https://e-hentai.org/gallerytorrents.php?gid=987654").galleryHref,
    ).toBeNull();
    expect(
      parseGalleryTorrents(doc, "https://e-hentai.org/gallerytorrents.php?t=abcdef1234")
        .galleryHref,
    ).toBeNull();
    expect(
      parseGalleryTorrents(doc, "https://e-hentai.org/gallerytorrents.php?gid=x&t=abcdef1234")
        .galleryHref,
    ).toBeNull();
    expect(
      parseGalleryTorrents(doc, "https://e-hentai.org/gallerytorrents.php?gid=987654&t=not-a-token")
        .galleryHref,
    ).toBeNull();
  });

  test("reads every field of each torrent form", () => {
    expect(data.torrents).toHaveLength(2);
    expect(data.torrents[0]).toEqual({
      gtid: "1001",
      name: "Test Gallery.zip",
      posted: "2024-01-01 12:00",
      size: "10.50 MiB",
      seeds: 12,
      peers: 2,
      downloads: 40,
      uploader: "TestUploader",
      downloadHref:
        "https://ehtracker.org/get/987654/aaaaaaaaaaaa1111/bbbbbbbbbbbb2222cccccccccccc3333.torrent",
    });
    expect(data.torrents[1]).toEqual({
      gtid: "1002",
      name: "Test Gallery [v2].zip",
      posted: "2024-02-02 08:30",
      size: "5.25 MiB",
      seeds: 0,
      peers: 1,
      downloads: 3,
      uploader: "SecondUploader",
      downloadHref:
        "https://ehtracker.org/get/987654/dddddddddddd4444/eeeeeeeeeeee5555ffffffffffff6666.torrent",
    });
  });

  test("accepts a notice-only page as an empty list", () => {
    const empty = parseDocument(
      '<div id="torrentinfo"><h1>Test Gallery</h1><p>No torrents were found for this gallery.</p></div>',
    );
    const parsed = parseGalleryTorrents(empty, PAGE_URL);

    expect(parsed.torrents).toEqual([]);
    expect(() => assertGalleryTorrentsPage(parsed, empty)).not.toThrow();
  });

  test("rejects a page whose torrent container has no rows and no notice", () => {
    const broken = parseDocument(
      '<div id="torrentinfo"><h1>Test Gallery</h1><div>Unexpected layout</div></div>',
    );
    const parsed = parseGalleryTorrents(broken, PAGE_URL);

    expect(parsed.torrents).toEqual([]);
    expect(() => assertGalleryTorrentsPage(parsed, broken)).toThrow(ParseMismatchError);
  });

  test("rejects a page with no torrent container at all", () => {
    const broken = parseDocument("<html><body><h1>Not the popup</h1></body></html>");
    const parsed = parseGalleryTorrents(broken, PAGE_URL);

    expect(parsed.title).toBe("");
    expect(() => assertGalleryTorrentsPage(parsed, broken)).toThrow(ParseMismatchError);
  });

  test("ignores a form that carries no torrent id", () => {
    const broken = parseDocument(
      '<div id="torrentinfo"><h1>Test Gallery</h1><p>No torrents were found for this gallery.</p><form><input name="other" value="1"></form></div>',
    );

    expect(parseGalleryTorrents(broken, PAGE_URL).torrents).toEqual([]);
  });
});

describe("parseTorrentInfo", () => {
  test("reads the info table, both tracker links and the comments", () => {
    expect(parseTorrentInfo(infoDoc, PAGE_URL)).toEqual({
      name: "Test Gallery.zip",
      posted: "2024-01-01 12:00",
      size: "10.50 MiB",
      seeds: 12,
      peers: 2,
      completes: 40,
      uploader: "TestUploader",
      personalizedHref:
        "https://ehtracker.org/get/987654/aaaaaaaaaaaa1111/personalized1111222233334444.torrent",
      redistributableHref:
        "https://ehtracker.org/get/987654/aaaaaaaaaaaa1111/redistributable5555666677778888.torrent",
      comments: "A test comment for this torrent.",
    });
  });

  test("returns null when the response has no info block", () => {
    expect(parseTorrentInfo(parseDocument("<p>Not found</p>"), PAGE_URL)).toBeNull();
  });
});
