import { describe, expect, test } from "bun:test";

import { parseMyTags, parseUserTags } from "../../src/parse/my-tags";
import { loadFixture, parseDocument } from "../dom";

const MYTAGS_URL = "https://e-hentai.org/mytags";

const doc = await loadFixture("mytags.html");
const data = parseMyTags(doc, MYTAGS_URL);

describe("parseMyTags", () => {
  test("reads both saved tags and skips the blank add row", () => {
    expect(data.url).toBe(MYTAGS_URL);
    expect(data.tags).toEqual([
      {
        id: 4242,
        name: "female:enema",
        watched: true,
        hidden: false,
        color: "#ff8800",
        weight: 15,
      },
      {
        id: 4243,
        name: "language:english",
        watched: false,
        hidden: true,
        color: "",
        weight: 10,
      },
    ]);
  });

  test("reads the page's inline API credentials", () => {
    expect(data.api).toEqual({
      apiUrl: "https://api.e-hentai.org/api.php",
      apiUid: "424242",
      apiKey: "fake-api-key",
    });
  });

  test("returns an empty page when the site markup is missing", () => {
    const plain = parseDocument("<body></body>");
    expect(parseMyTags(plain, MYTAGS_URL)).toEqual({
      url: MYTAGS_URL,
      tags: [],
      api: null,
    });
    expect(parseUserTags(plain)).toEqual([]);
  });

  test("normalizes colours and rejects invalid input", () => {
    const plain = parseDocument(`
      <div id="usertags_outer">
        <div id="usertag_7">
          <div id="tagpreview_7" title="artist:someone"></div>
          <input id="tagcolor_7" value="ABC">
          <input id="tagweight_7" value="not a number">
        </div>
      </div>
    `);
    const [tag] = parseUserTags(plain);
    expect(tag?.color).toBe("#abc");
    expect(tag?.weight).toBe(10);
  });
});
