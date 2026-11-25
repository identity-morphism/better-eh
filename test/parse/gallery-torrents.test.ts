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
  test("keeps the page identity and builds the in-app gallery address", () => {
    const data = parseGalleryTorrents(doc, PAGE_URL);

    expect(data.url).toBe(PAGE_URL);
    expect(data.title).toBe("Test Gallery");
    expect(data.galleryHref).toBe("/g/987654/abcdef1234/");
    expect(
      parseGalleryTorrents(doc, "https://e-hentai.org/gallerytorrents.php?gid=987654").galleryHref,
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

  test("accepts a notice-only page as an empty list", () => {
    const empty = parseDocument(
      '<div id="torrentinfo"><h1>Test Gallery</h1><p>No torrents were found for this gallery.</p><form><input name="other" value="1"></form></div>',
    );
    const parsed = parseGalleryTorrents(empty, PAGE_URL);

    expect(parsed.torrents).toEqual([]);
    expect(() => assertGalleryTorrentsPage(parsed, empty)).not.toThrow();
  });

  test("rejects a page with no torrent rows, notice or container", () => {
    const noNotice = parseDocument(
      '<div id="torrentinfo"><h1>Test Gallery</h1><div>Unexpected layout</div></div>',
    );
    expect(() =>
      assertGalleryTorrentsPage(parseGalleryTorrents(noNotice, PAGE_URL), noNotice),
    ).toThrow(ParseMismatchError);

    const noContainer = parseDocument("<html><body><h1>Not the popup</h1></body></html>");
    const parsed = parseGalleryTorrents(noContainer, PAGE_URL);
    expect(parsed.title).toBe("");
    expect(() => assertGalleryTorrentsPage(parsed, noContainer)).toThrow(ParseMismatchError);
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
