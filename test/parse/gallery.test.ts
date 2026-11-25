import { describe, expect, test } from "bun:test";

import {
  formatPageRange,
  parseGalleryApiConfig,
  parseGalleryPage,
  parseGalleryThumbPage,
} from "../../src/parse/gallery";
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

describe("parseGalleryThumbPage", () => {
  test("returns the same thumbs and next link as the full parser on each gallery fixture", async () => {
    for (const name of ["gallery.html", "gallery-comments.html"]) {
      const fixture = await loadFixture(name);
      const full = parseGalleryPage(fixture, GALLERY_URL);

      expect(parseGalleryThumbPage(fixture, GALLERY_URL)).toEqual({
        items: full.thumbs,
        next: full.nextHref,
      });
    }
  });

  test("parses a thumbnail page without tags, comments, actions or credentials", () => {
    const fragment = parseDocument(`
      <div id="gdt">
        <a href="/s/aaa/123456-1"
          ><div
            style="background-image:url(/sprites/a.jpg);width:200px;height:150px;background-position:0px 0px"
          ></div
        ></a>
        <a href="/s/aaa/123456-2"
          ><div
            style="background-image:url(/sprites/a.jpg);width:200px;height:150px;background-position:150px 0px"
            title="Page 2"
          ></div
        ></a>
      </div>
      <div class="gpc">Showing 26 - 50 of 60</div>
    `);

    const page = parseGalleryThumbPage(fragment, "https://e-hentai.org/g/123456/abcdef1234/?p=1");

    expect(page.items).toEqual([
      {
        href: "https://e-hentai.org/s/aaa/123456-1",
        label: 1,
        sprite: "/sprites/a.jpg",
        x: 0,
        width: 200,
        height: 150,
        spriteCount: 2,
      },
      {
        href: "https://e-hentai.org/s/aaa/123456-2",
        label: 2,
        sprite: "/sprites/a.jpg",
        x: 150,
        width: 200,
        height: 150,
        spriteCount: 2,
      },
    ]);
    expect(page.next).toBe("https://e-hentai.org/g/123456/abcdef1234/?p=2");
  });
});

describe("inline script values", () => {
  test("reads assignments split across scripts, skipping external scripts", () => {
    const parsed = parseDocument(`
      <script>var api_url = "https://api.example/api.php";</script>
      <script src="/static.js">var apiuid = 999;</script>
      <script>var apiuid = 42; var apikey = 'key';</script>
      <script>
        var gid = 123456;
        var token = "tok";
      </script>
    `);

    expect(parseGalleryApiConfig(parsed)).toEqual({
      apiUrl: "https://api.example/api.php",
      apiUid: "42",
      apiKey: "key",
      gid: "123456",
      token: "tok",
    });
  });

  test("keeps the first occurrence of each value", () => {
    const parsed = parseDocument(`
      <script>
        var api_url = "https://api.example/api.php";
        var apiuid = 1;
        var apikey = "first";
        var gid = 111;
        var token = "first-token";
        var display_rating = 2.5;
      </script>
      <script>
        var api_url = "https://evil.example/api.php";
        var apiuid = 2;
        var apikey = "second";
        var gid = 222;
        var token = "second-token";
        var display_rating = 4.5;
      </script>
      <h1 id="gn">A Gallery</h1>
      <div id="rating_image" class="ir irr"></div>
      <div id="rating_label">Average: 4.00</div>
    `);

    const page = parseGalleryPage(parsed, GALLERY_URL);

    expect(page.apiConfig).toEqual({
      apiUrl: "https://api.example/api.php",
      apiUid: "1",
      apiKey: "first",
      gid: "111",
      token: "first-token",
    });
    expect(page.ratingInfo.user).toBe(2.5);
  });
});
