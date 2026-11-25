import { describe, expect, test } from "bun:test";

import { parseViewer } from "../../src/parse/viewer";
import { loadFixture } from "../dom";

const VIEWER_URL = "https://e-hentai.org/s/hash123/987654-2";

describe("parseViewer", () => {
  test("parses the image, counter, nl token, file info and gallery link", async () => {
    const doc = await loadFixture("viewer.html");
    const data = parseViewer(doc, VIEWER_URL);

    expect(data.pageNum).toBe(2);
    expect(data.imgSrc).toBe("https://img.example/pages/2.jpg");
    expect(data.originalHref).toBe("https://e-hentai.org/fullimg/987654/2/abc123/02.png");
    expect(data.counterText).toBe("2 / 3");
    expect(data.nlToken).toBe("777-abc");
    expect(data.fileInfo).toBe("1,234 KB :: 800 x 1200");
    expect(data.galleryHref).toBe("https://e-hentai.org/g/987654/abcdef1234/");
    expect(data.forumHref).toBe("https://e-hentai.org/forumtoken/987654-2/abc123/02.png");
    expect(data.searchHref).toBe("https://e-hentai.org/?f_shash=abc123&fs_from=02.png");
    expect(data.galleryTitle).toEqual({
      leading: [{ text: "[Circle]", type: "artist" }],
      primary: "A Viewer Title",
      secondary: "Subtitle",
      trailing: [{ text: "[English]", type: "lang" }],
    });
  });

  test("derives previous and next links from numbered anchors", async () => {
    const doc = await loadFixture("viewer.html");
    const data = parseViewer(doc, VIEWER_URL);

    expect(data.prevHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(data.nextHref).toBe("https://e-hentai.org/s/hash123/987654-3");
    expect(data.firstHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(data.lastHref).toBe("https://e-hentai.org/s/hash123/987654-3");
  });

  test("last page has no next link", async () => {
    const doc = await loadFixture("viewer-last.html");
    const data = parseViewer(doc, "https://e-hentai.org/s/hash123/987654-3");

    expect(data.counterText).toBe("3 / 3");
    expect(data.nextHref).toBeNull();
    expect(data.prevHref).toBe("https://e-hentai.org/s/hash123/987654-2");
  });

  test("page one has no previous link", async () => {
    const doc = await loadFixture("viewer-fallback.html");
    const data = parseViewer(doc, "https://e-hentai.org/s/hash123/987654-1");

    expect(data.pageNum).toBe(1);
    expect(data.prevHref).toBeNull();
  });

  test("builds the previous URL when no numbered anchor exists", async () => {
    const doc = await loadFixture("viewer-fallback.html");
    const data = parseViewer(doc, VIEWER_URL);

    expect(data.prevHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(data.nextHref).toBeNull();
    expect(data.counterText).toBe("2 / ?");
    expect(data.imgSrc).toBe("");
    expect(data.fileInfo).toBe("");
    expect(data.galleryHref).toBe("#");
    expect(data.galleryTitle.primary).toBe("Fallback Page");
  });

  test("derives next from the #i3 anchor when no numbered link matches", async () => {
    const doc = await loadFixture("viewer-next-fallback.html");
    const data = parseViewer(doc, "https://e-hentai.org/s/hash123/987654-1");

    expect(data.nextHref).toBe("https://e-hentai.org/s/hash123/987654-2/");
    expect(data.prevHref).toBeNull();
  });
});
