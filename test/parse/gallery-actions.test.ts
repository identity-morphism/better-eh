import { describe, expect, test } from "bun:test";

import { parseGalleryApiConfig, parseGalleryPage } from "../../src/parse/gallery";
import type { GalleryData } from "../../src/types";
import { loadFixture } from "../dom";

const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";

const doc = await loadFixture("gallery-comments.html");
const data = parseGalleryPage(doc, GALLERY_URL);

describe("parseGalleryPage comments, rating and actions", () => {
  test("parses the uploader comment and a voted comment", () => {
    expect(data.comments).toEqual([
      {
        id: 0,
        author: "alice",
        authorHref: "https://e-hentai.org/uploader/alice",
        posted: "02 January 2024, 03:04",
        body: "Thanks for reading\nPart two soon",
        score: null,
        votes: null,
        uploader: true,
        editable: false,
      },
      {
        id: 9001,
        author: "bob",
        authorHref: "https://e-hentai.org/uploader/bob",
        posted: "03 January 2024, 10:00",
        body: "Great work's pacing",
        score: 7,
        votes: "Base +8, carol -1",
        uploader: false,
        editable: true,
      },
    ]);
  });

  test("parses the rating average, vote count and the viewer's half-star rating", () => {
    expect(data.ratingInfo).toEqual({ average: 4.52, votes: 9, user: 4.5 });
    expect(data.rating).toBe(4.52);
    expect(data.ratingCount).toBe(9);
  });

  test("keeps display_rating out of the user rating while the star sprite is uncoloured", async () => {
    const unrated = await loadFixture("gallery-comments.html");
    unrated.getElementById("rating_image")?.setAttribute("class", "ir");

    expect(parseGalleryPage(unrated, GALLERY_URL).ratingInfo).toEqual({
      average: 4.52,
      votes: 9,
      user: null,
    });
  });

  test("resolves every action link, including the popup and rename targets", () => {
    expect(data.actions).toEqual({
      archiverHref: "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234",
      torrentsHref: "https://e-hentai.org/gallerytorrents.php?gid=123456&t=abcdef1234",
      reportHref: "https://e-hentai.org/g/123456/abcdef1234/?report=select",
      expungeHref: "https://e-hentai.org/g/123456/abcdef1234/?act=expunge",
      renameHref: "https://e-hentai.org/gallerypopups.php?gid=123456&t=abcdef1234&act=rename",
    });
  });

  test("keeps the site's visibility phrase", () => {
    expect(data.visible).toBe("Yes");
  });

  test("reads the API credentials from the inline script", () => {
    expect(parseGalleryApiConfig(doc)).toEqual({
      apiUrl: "https://api.e-hentai.org/api.php",
      apiUid: "777",
      apiKey: "key123",
      gid: "123456",
      token: "abcdef1234",
    });
  });
});

describe("parseGalleryPage without site extras", () => {
  test("leaves new fields empty on a page with no comments or API script", async () => {
    const plain: GalleryData = parseGalleryPage(await loadFixture("gallery.html"), GALLERY_URL);

    expect(plain.comments).toEqual([]);
    expect(plain.ratingInfo).toEqual({ average: 4.5, votes: 1234, user: null });
    expect(plain.actions).toEqual({
      archiverHref: null,
      torrentsHref: null,
      reportHref: null,
      expungeHref: null,
      renameHref: null,
    });
    expect(plain.visible).toBeNull();
    expect(plain.apiConfig).toBeNull();
  });
});
