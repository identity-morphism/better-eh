import { describe, expect, test } from "bun:test";

import { parseMyTags, parseTagset, parseUserTags } from "../../src/parse/my-tags";
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
        name: "female:entry",
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

  test("reads every tagset and the current set's controls", () => {
    expect(data.tagsets).toEqual({
      choices: [
        { id: "1", label: "Tagset #1 (2)", selected: true },
        { id: "2", label: "Reading (1)", selected: false },
      ],
      currentId: "1",
      name: "Tagset #1",
      enabled: true,
      color: "#ff8800",
      action: MYTAGS_URL,
      fields: [
        { name: "tagset_action", kind: "value", value: "" },
        { name: "tagset_name", kind: "value", value: "" },
        { name: "tagset_enable", kind: "checkbox", value: "on" },
        { name: "tagset_color", kind: "value", value: "#FF8800" },
      ],
    });
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
      tagsets: null,
      api: null,
    });
    expect(parseUserTags(plain)).toEqual([]);
    expect(parseTagset(plain, MYTAGS_URL)).toBeNull();
  });

  test("round-trips unknown fields, resolves an empty action and does not assume enablement", () => {
    const page = parseDocument(`
      <form id="tagset_form" action="" method="post">
        <input type="hidden" name="tagset_action" value="">
        <input type="hidden" name="site_marker" value="keep-me">
        <select>
          <option value="1">First (0)</option>
          <option value="2" selected="selected">Second (1)</option>
        </select>
        <input type="checkbox" name="tagset_enable">
        <input type="text" name="tagset_color" value="nope">
      </form>
    `);

    const tagset = parseTagset(page, "https://e-hentai.org/mytags?tagset=2");
    expect(tagset?.name).toBe("Second");
    expect(tagset?.enabled).toBe(false);
    expect(tagset?.color).toBe("");
    expect(tagset?.action).toBe("https://e-hentai.org/mytags?tagset=2");
    expect(tagset?.currentId).toBe("2");
    expect(tagset?.choices.map((choice) => choice.selected)).toEqual([false, true]);
    expect(tagset?.fields).toContainEqual({
      name: "site_marker",
      kind: "value",
      value: "keep-me",
    });

    const noEnable = parseDocument(`
      <form id="tagset_form" action="" method="post">
        <select><option value="1" selected="selected">Only (0)</option></select>
        <input type="text" name="tagset_color" value="">
      </form>
    `);
    const unchecked = parseTagset(noEnable, MYTAGS_URL);
    expect(unchecked?.enabled).toBe(false);
    expect(unchecked?.fields.map((field) => field.name)).not.toContain("tagset_enable");
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
