import { describe, expect, test } from "bun:test";

import { HttpError } from "../../src/fetch/errors";
import { parseGalleryPage } from "../../src/parse/gallery";
import { parseDocument } from "../dom";

const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";

const NOTE_PAGE = `
  <h1 id="gn">A Gallery</h1>
  <div id="taglist">
    <table>
      <tbody>
        <tr>
          <td class="tc">language:</td>
          <td>
            <a href="/tag/language:japanese">japanese | definition revised please read the wiki</a>
            <a href="/tag/language:english">english</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
`;

describe("parseGalleryPage tag notes", () => {
  test("splits the site's note off the tag name", () => {
    const [group] = parseGalleryPage(parseDocument(NOTE_PAGE), GALLERY_URL).tags;

    expect(group).toEqual({
      ns: "language",
      tags: [
        {
          name: "japanese",
          href: "https://e-hentai.org/tag/language:japanese",
          note: "definition revised please read the wiki",
        },
        { name: "english", href: "https://e-hentai.org/tag/language:english", note: null },
      ],
    });

    const html = NOTE_PAGE.replace(
      "japanese | definition revised please read the wiki",
      "japanese | see the wiki | and the forum",
    );
    const [split] = parseGalleryPage(parseDocument(html), GALLERY_URL).tags;
    expect(split?.tags[0]).toEqual({
      name: "japanese",
      href: "https://e-hentai.org/tag/language:japanese",
      note: "see the wiki | and the forum",
    });
  });
});

describe("parseGalleryPage degenerate documents", () => {
  test("rejects a page with neither a title nor a thumbnail", () => {
    const doc = parseDocument("<body></body>");

    expect(() => parseGalleryPage(doc, GALLERY_URL)).toThrow(HttpError);
    try {
      parseGalleryPage(doc, GALLERY_URL);
    } catch (error) {
      expect((error as HttpError).status).toBe(404);
      expect((error as HttpError).url).toBe(GALLERY_URL);
    }
  });

  test("keeps a page that still has thumbnails but lost its title", () => {
    const html = `
      <div id="gdt">
        <a href="/s/abc/123456-1">
          <div
            style="background-image:url(/sprites/a.jpg);width:200px;height:150px;background-position:0px 0px"
          ></div>
        </a>
      </div>
    `;
    const data = parseGalleryPage(parseDocument(html), GALLERY_URL);

    expect(data.title.primary).toBe("Untitled");
    expect(data.thumbs).toHaveLength(1);
  });
});
