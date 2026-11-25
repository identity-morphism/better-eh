import { describe, expect, test } from "bun:test";

import { parseGalleryPage } from "../../src/parse/gallery";
import { loadFixture, parseDocument } from "../dom";

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
});

describe("parseGalleryPage without site extras", () => {
  test("leaves comments and credentials empty on a plain page", async () => {
    const plain = parseGalleryPage(await loadFixture("gallery.html"), GALLERY_URL);

    expect(plain.comments).toEqual([]);
    expect(plain.apiConfig).toBeNull();
  });
});

describe("parseGalleryPage comment bodies and edit flags", () => {
  test("keeps br newlines through nested markup and collapses blank runs", () => {
    const parsed = parseDocument(`
      <h1 id="gn">A Gallery</h1>
      <div id="cdiv">
        <div class="c1">
          <div class="c3">Posted on 02 January 2024, 03:04 by: <a href="/uploader/alice">alice</a></div>
          <div class="c6" id="comment_5"><span>Great</span> work<br /><br /><br />part two</div>
        </div>
      </div>
    `);

    const [comment] = parseGalleryPage(parsed, GALLERY_URL).comments;

    expect(comment?.body).toBe("Great work\n\npart two");
  });

  test("marks only the comment its edit marker belongs to", () => {
    const parsed = parseDocument(`
      <h1 id="gn">A Gallery</h1>
      <div id="cdiv">
        <div class="c1">
          <div class="c3">Posted on 02 January 2024, 03:04 by: <a href="/uploader/alice">alice</a></div>
          <div class="c6" id="comment_7">First</div>
          <button data-comment-edit="7">Change</button>
        </div>
        <div class="c1">
          <div class="c3">Posted on 03 January 2024, 03:04 by: <a href="/uploader/bob">bob</a></div>
          <div class="c6" id="comment_8">Second</div>
        </div>
        <div id="formdiv"><button type="submit">Post Comment</button></div>
      </div>
    `);

    const comments = parseGalleryPage(parsed, GALLERY_URL).comments;

    expect(comments.map((comment) => comment.editable)).toEqual([true, false]);
  });
});
