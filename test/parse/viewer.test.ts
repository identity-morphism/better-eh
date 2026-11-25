import { describe, expect, test } from "bun:test";

import { parseViewer } from "../../src/parse/viewer";
import { loadFixture } from "../dom";

const VIEWER_URL = "https://e-hentai.org/s/hash123/987654-2";

const doc = await loadFixture("viewer.html");
const data = parseViewer(doc, VIEWER_URL);

describe("parseViewer", () => {
  test("parses the image, counter, token, file info, links and navigation", () => {
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

    expect(data.prevHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(data.nextHref).toBe("https://e-hentai.org/s/hash123/987654-3");
    expect(data.firstHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(data.lastHref).toBe("https://e-hentai.org/s/hash123/987654-3");
  });

  test("last page has no next link", async () => {
    const lastDoc = await loadFixture("viewer-last.html");
    const last = parseViewer(lastDoc, "https://e-hentai.org/s/hash123/987654-3");

    expect(last.counterText).toBe("3 / 3");
    expect(last.nextHref).toBeNull();
    expect(last.prevHref).toBe("https://e-hentai.org/s/hash123/987654-2");
  });

  test("fallback markup degrades missing fields and still builds navigation", async () => {
    const fallbackDoc = await loadFixture("viewer-fallback.html");
    const first = parseViewer(fallbackDoc, "https://e-hentai.org/s/hash123/987654-1");
    expect(first.pageNum).toBe(1);
    expect(first.prevHref).toBeNull();

    const second = parseViewer(fallbackDoc, VIEWER_URL);
    expect(second.prevHref).toBe("https://e-hentai.org/s/hash123/987654-1");
    expect(second.nextHref).toBeNull();
    expect(second.counterText).toBe("2 / ?");
    expect(second.imgSrc).toBe("");
    expect(second.fileInfo).toBe("");
    expect(second.galleryHref).toBe("#");
    expect(second.galleryTitle.primary).toBe("Fallback Page");
  });

  test("derives next from the #i3 anchor when no numbered link matches", async () => {
    const nextDoc = await loadFixture("viewer-next-fallback.html");
    const next = parseViewer(nextDoc, "https://e-hentai.org/s/hash123/987654-1");

    expect(next.nextHref).toBe("https://e-hentai.org/s/hash123/987654-2/");
    expect(next.prevHref).toBeNull();
  });
});
