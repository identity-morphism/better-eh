import { describe, expect, test } from "bun:test";

import { parseListPage } from "../../src/parse/list";
import { loadFixture, parseDocument } from "../dom";

const LIST_URL = "https://e-hentai.org/?f_search=foo&p=2";

const doc = await loadFixture("list.html");
const data = parseListPage(doc, LIST_URL);

const thumbsDoc = await loadFixture("list-thumbs.html");
const thumbs = parseListPage(thumbsDoc, "https://e-hentai.org/?f_search=bar");

const uploaderDoc = await loadFixture("list-uploader.html");
const uploader = parseListPage(uploaderDoc, "https://e-hentai.org/uploader/lasthm");

const favoriteDoc = await loadFixture("list-favorite.html");
const favorite = parseListPage(favoriteDoc, "https://e-hentai.org/?f_search=fav");

describe("parseListPage", () => {
  test("parses table rows, skips duplicates and invalid gallery tokens", () => {
    expect(data.items).toHaveLength(2);
    expect(data.items.map((item) => item.gid)).toEqual(["111", "222"]);
  });

  test("parses table rows into listing items", () => {
    expect(data.items[0]).toEqual({
      href: "https://e-hentai.org/g/111/aaaa/",
      gid: "111",
      token: "aaaa",
      title: {
        leading: [{ text: "[Circle]", type: "artist" }],
        primary: "Alpha",
        secondary: null,
        trailing: [{ text: "[English]", type: "lang" }],
      },
      coverSrc: "https://img.example/111.jpg",
      coverSize: { width: 250, height: 353 },
      rating: 4,
      category: { name: "Doujinshi", cls: "ct2" },
      uploader: "alice74",
      uploaderHref: "https://e-hentai.org/uploader/alice74",
      posted: "2024-01-01 12:00",
      pages: 10,
      torrentsHref: "https://e-hentai.org/gallerytorrents.php?gid=111&t=aaaa",
      favorite: null,
    });
    expect(data.items[1]).toEqual({
      href: "https://e-hentai.org/g/222/bbbb/",
      gid: "222",
      token: "bbbb",
      title: {
        leading: [],
        primary: "Beta",
        secondary: "Extra",
        trailing: [],
      },
      coverSrc: "https://img.example/222.jpg",
      coverSize: { width: 250, height: 106 },
      rating: 2.5,
      category: { name: "Artist CG", cls: "ct4" },
      uploader: null,
      uploaderHref: null,
      posted: "",
      pages: 5,
      torrentsHref: null,
      favorite: null,
    });
  });

  test("parses the result summary and resolves next/previous links", () => {
    expect(data.resultText).toBe("Found 1,234 results.");
    expect(data.nextHref).toBe("https://e-hentai.org/?f_search=foo&p=1");
    expect(data.prevHref).toBe("https://e-hentai.org/?f_search=foo&p=0");
  });
});

describe("parseListPage without a tbody", () => {
  test("parses table rows the DOM did not wrap in a tbody", () => {
    const page = parseListPage(
      parseDocument(`
        <table class="itg">
          <tr>
            <td class="gl1c glcat"><div class="cn ct1">Misc</div></td>
            <td class="gl2c">
              <div class="glthumb"><img src="https://img.example/cover.jpg" style="width:250px;height:300px"></div>
              <div id="postedpop_7">2026-01-01 12:00</div>
            </td>
            <td class="gl3c glname"><a href="/g/7/abc/"><div class="glink">[Artist] A Title</div></a></td>
            <td class="gl4c"><a href="/uploader/u">u</a><div>10 pages</div></td>
          </tr>
        </table>`),
      "https://e-hentai.org/",
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.gid).toBe("7");
    expect(page.items[0]?.title.primary).toBe("A Title");
    expect(page.items[0]?.pages).toBe(10);
  });
});

describe("parseListPage page counts", () => {
  /** One table row around a category/title cell and an arbitrary pages cell. */
  function row(pagesCell: string): Document {
    return parseDocument(`
      <table class="itg"><tbody><tr>
        <td class="gl3c"><a class="glink" href="/g/111/aaaa/">Alpha</a></td>
        <td class="gl4c">${pagesCell}</td>
      </tr></tbody></table>
    `);
  }

  test("reads a count split across nodes through the ancestor scan", () => {
    const split = row("<span>42</span> pages");
    expect(parseListPage(split, LIST_URL).items[0]?.pages).toBe(42);
  });

  test("takes a leaf count over an ancestor whose glued text is not one", () => {
    const glued = row("<div>alice7410 pages</div><div>7 pages</div>");
    expect(parseListPage(glued, LIST_URL).items[0]?.pages).toBe(7);
  });

  test("keeps thousands separators and singular wording", () => {
    const commas = row("<div>1,234 pages</div>");
    expect(parseListPage(commas, LIST_URL).items[0]?.pages).toBe(1234);
    const single = row("<div>1 page</div>");
    expect(parseListPage(single, LIST_URL).items[0]?.pages).toBe(1);
  });
});

describe("parseListPage favorite marks", () => {
  test("reads the folder and slot from the posted-date outline", () => {
    expect(favorite.items[0]?.favorite).toEqual({ folder: "Read later", slot: 2 });
    expect(favorite.items[1]?.favorite).toBeNull();
  });

  test("keeps a mark whose colour is not one of the ten folder slots", () => {
    expect(favorite.items[2]?.favorite).toEqual({ folder: "Odd folder", slot: null });
  });
});

describe("parseListPage thumbnail fallback", () => {
  test("parses .gl1t items, summary and missing pager links", () => {
    expect(thumbs.items.map((item) => item.gid)).toEqual(["333", "444"]);
    expect(thumbs.resultText).toBe("Found 2 results.");
    expect(thumbs.nextHref).toBeNull();
    expect(thumbs.prevHref).toBeNull();
    expect(thumbs.items[0]).toEqual({
      href: "https://e-hentai.org/g/333/cccc/",
      gid: "333",
      token: "cccc",
      title: { leading: [], primary: "Gamma", secondary: null, trailing: [] },
      coverSrc: "https://img.example/333.jpg",
      coverSize: null,
      rating: null,
      category: { name: "Image Set", cls: "ct6" },
      uploader: null,
      uploaderHref: null,
      posted: "",
      pages: null,
      torrentsHref: null,
      favorite: null,
    });

    const item = thumbs.items[1];
    expect(item?.title).toEqual({
      leading: [{ text: "[Circle]", type: "artist" }],
      primary: "Delta",
      secondary: null,
      trailing: [],
    });
    expect(item?.coverSrc).toBe("https://img.example/444.jpg");
    expect(item?.coverSize).toEqual({ width: 250, height: 353 });
    expect(item?.rating).toBe(2);
    expect(item?.torrentsHref).toBe("https://e-hentai.org/gallerytorrents.php?gid=444&t=dddd");
    expect(item?.category).toEqual({ name: "Misc", cls: "ct1" });
    expect(item?.pages).toBe(3);
  });

  test("prefers the watched result line over the filter notice", async () => {
    const watched = parseListPage(
      await loadFixture("list-watched.html"),
      "https://e-hentai.org/watched",
    );

    expect(watched.resultText).toBe("Showing results for 11 watched tags");
    expect(watched.items).toHaveLength(1);
  });
});

describe("parseListPage uploader layout", () => {
  test("parses the uploader table", () => {
    expect(uploader.items.map((item) => item.gid)).toEqual(["4280070", "4280000"]);
    expect(uploader.items[0]).toMatchObject({
      href: "https://e-hentai.org/g/4280070/2922f6343f/",
      token: "2922f6343f",
      coverSrc: "https://img.example/4280070.webp",
      category: { name: "Manga", cls: "ct3" },
      uploader: "lasthm",
      uploaderHref: "https://e-hentai.org/uploader/lasthm",
      posted: "2026-10-25 02:59",
      pages: 171,
    });
    expect(uploader.items[1]?.title).toEqual({
      leading: [],
      primary: "Beta",
      secondary: "Extra",
      trailing: [],
    });
  });

  test("reads the result line and the cursor pager", () => {
    expect(uploader.resultText).toBe("Found 1,651 results.");
    expect(uploader.nextHref).toBe("https://e-hentai.org/uploader/lasthm?next=4280000");
    expect(uploader.prevHref).toBeNull();
  });
});
