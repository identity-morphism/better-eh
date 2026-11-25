import { describe, expect, test } from "bun:test";

import { formatPageRange, parseGalleryPage } from "../../src/parse/gallery";
import { loadFixture, parseDocument } from "../dom";

const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";

const doc = await loadFixture("gallery.html");
const data = parseGalleryPage(doc, GALLERY_URL);

describe("parseGalleryPage actions", () => {
  test("a rename link only follows base_url while it stays on the site", async () => {
    const renameHref = async (base: string): Promise<string | null> => {
      const parsed = await loadFixture("gallery-comments.html");
      for (const script of parsed.querySelectorAll("script")) {
        if (script.textContent.includes("base_url")) {
          script.textContent = script.textContent.replace("https://e-hentai.org/", base);
        }
      }
      return parseGalleryPage(parsed, GALLERY_URL).actions.renameHref;
    };

    expect(await renameHref("https://evil.example/")).toContain("e-hentai.org/gallerypopups.php");
    expect(await renameHref("/")).toContain("e-hentai.org/gallerypopups.php");
  });
});

describe("parseGalleryPage", () => {
  test("parses identity, titles and metadata", () => {
    expect(data.gid).toBe("123456");
    expect(data.token).toBe("abcdef1234");
    expect(data.title.primary).toBe("The Great Work");
    expect(data.title.secondary).toBe("A Side Story");
    expect(data.alternateTitle).toBe("Alternate Title");
    expect(data.posted).toBe("2024-01-02 03:04");
    expect(data.parentHref).toBe("https://e-hentai.org/g/100/parentcafe/");
    expect(data.size).toBe("123 MB");
    expect(data.pageCount).toBe(60);
    expect(data.category).toEqual({ name: "Manga", cls: "ct3" });
  });

  test("parses uploader, rating and favorite count", () => {
    expect(data.uploader).toEqual({
      name: "alice",
      href: "https://e-hentai.org/uploader/alice",
    });
    expect(data.rating).toBe(4.5);
    expect(data.ratingCount).toBe(1234);
    expect(data.favCount).toBe(42);
  });

  test("favorite folder is absent when the favorite area is empty", () => {
    const empty = parseGalleryPage(
      parseDocument('<h1 id="gn">A Gallery</h1><div id="fav"></div>'),
      GALLERY_URL,
    );
    expect(empty.favorite).toBeNull();
  });

  test("parses sprite thumbs, labels and sprite counts", () => {
    expect(data.thumbs).toHaveLength(3);
    expect(data.thumbs[1]).toMatchObject({
      href: "https://e-hentai.org/s/spr0/123456-2",
      label: 2,
      sprite: "/sprites/a.jpg",
      x: -200,
      width: 200,
      height: 150,
      spriteCount: 2,
    });
    expect(data.thumbs[2]?.spriteCount).toBe(1);
    expect(data.firstPageHref).toBe("https://e-hentai.org/s/spr0/123456-1");
  });

  test("parses the cover and paging summary", () => {
    expect(data.coverSrc).toBe("https://img.example/cover.jpg");
    expect(data.coverSize).toEqual({ width: 250, height: 176 });
    expect(data.pageSummary).toBe("Showing 1 - 25 of 60");
    expect(data.pageRange).toEqual({ start: 1, end: 25, total: 60, suffix: "" });
    expect(data.prevHref).toBeNull();
    expect(data.nextHref).toBe("https://e-hentai.org/g/123456/abcdef1234/?p=1");
  });

  test("formats a pager summary with thousands separators", () => {
    expect(formatPageRange({ start: 1, end: 3, total: 964330, suffix: "" })).toBe(
      "Showing 1 - 3 of 964,330",
    );
    expect(formatPageRange({ start: 1, end: 25, total: 60, suffix: " images" })).toBe(
      "Showing 1 - 25 of 60 images",
    );
  });

  test("derives prev and next links from the page parameter", () => {
    const paged = parseGalleryPage(
      parseDocument('<h1 id="gn">A Gallery</h1><div class="gpc">Showing 26 - 50 of 60</div>'),
      "https://e-hentai.org/g/123456/abcdef1234/?p=1",
    );
    expect(paged.prevHref).toBe(GALLERY_URL);
    expect(paged.nextHref).toBe("https://e-hentai.org/g/123456/abcdef1234/?p=2");

    // The last page has fewer thumbnails; infer the page size from `p`.
    const last = parseGalleryPage(
      parseDocument('<h1 id="gn">A Gallery</h1><div class="gpc">Showing 51 - 60 of 60</div>'),
      "https://e-hentai.org/g/123456/abcdef1234/?p=2",
    );
    expect(last.prevHref).toBe("https://e-hentai.org/g/123456/abcdef1234/?p=1");
    expect(last.nextHref).toBeNull();
  });

  test("rejects a URL that is not a gallery", () => {
    expect(() =>
      parseGalleryPage(parseDocument(""), "https://e-hentai.org/g/not-a-gallery/"),
    ).toThrow(Error);
  });
});
