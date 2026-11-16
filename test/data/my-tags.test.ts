import { describe, expect, test } from "bun:test";

import { applyMyTag, normalizeColor, parseUserTags } from "../../src/data/my-tags";
import type { GalleryApiConfig } from "../../src/types";
import { parseDocument } from "../dom";

const CONFIG: GalleryApiConfig = {
  apiUrl: "https://api.e-hentai.org/api.php",
  apiUid: "777",
  apiKey: "key123",
  gid: "123456",
  token: "abcdef1234",
};

function doc(): Document {
  return parseDocument(`
    <div id="usertags_outer">
      <div id="usertag_0">
        <input id="tagwatch_0" type="checkbox">
      </div>
      <div id="usertag_42">
        <div id="tagpreview_42" title="female:enema"></div>
        <input id="tagwatch_42" type="checkbox" checked>
        <input id="taghide_42" type="checkbox">
        <input id="tagcolor_42" value="#FF8800">
        <input id="tagweight_42" value="15">
      </div>
      <div id="usertag_43">
        <div id="tagpreview_43" title="language:english"></div>
        <input id="tagwatch_43" type="checkbox">
        <input id="taghide_43" type="checkbox" checked>
        <input id="tagcolor_43" value="">
        <input id="tagweight_43" value="10">
      </div>
    </div>
  `);
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    config: CONFIG,
    myTagsUrl: "https://e-hentai.org/mytags",
    loadDocument: () => Promise.resolve({ doc: doc(), url: "https://e-hentai.org/mytags" }),
    ...overrides,
  };
}

describe("My Tags parsing", () => {
  test("reads the saved tags and their current flags", () => {
    const tags = parseUserTags(doc());
    expect(tags).toEqual([
      {
        id: 42,
        name: "female:enema",
        watched: true,
        hidden: false,
        color: "#ff8800",
        weight: 15,
      },
      {
        id: 43,
        name: "language:english",
        watched: false,
        hidden: true,
        color: "",
        weight: 10,
      },
    ]);
  });

  test("normalizes colours and rejects invalid input", () => {
    expect(normalizeColor("#FF8800")).toBe("#ff8800");
    expect(normalizeColor("abc")).toBe("#abc");
    expect(normalizeColor("")).toBe("");
    expect(normalizeColor("#default")).toBe("");
    expect(normalizeColor(null)).toBe("");
  });
});

describe("My Tags mutations", () => {
  test("updates an existing tag through setusertag and preserves other fields", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    await applyMyTag(
      "Female:Enema",
      { watched: true },
      deps({
        post: (url: string, body: unknown) => {
          calls.push({ url, body });
          return Promise.resolve({ tagid: 42 });
        },
      }),
    );

    expect(calls).toEqual([
      {
        url: CONFIG.apiUrl,
        body: {
          method: "setusertag",
          apiuid: CONFIG.apiUid,
          apikey: CONFIG.apiKey,
          tagid: 42,
          tagwatch: 1,
          taghide: 0,
          tagcolor: "#ff8800",
          tagweight: 15,
        },
      },
    ]);
  });

  test("changing colour keeps watch/hide state", async () => {
    let body: Record<string, unknown> = {};
    await applyMyTag(
      "language:english",
      { color: "#00ff00" },
      deps({
        post: (_url: string, payload: unknown) => {
          body = payload as Record<string, unknown>;
          return Promise.resolve({ tagid: 43 });
        },
      }),
    );

    expect(body.tagwatch).toBe(0);
    expect(body.taghide).toBe(1);
    expect(body.tagcolor).toBe("#00ff00");
  });

  test("adds a tag missing from My Tags through the native form", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const result = await applyMyTag(
      "female:enema",
      { hidden: true },
      deps({
        loadDocument: () =>
          Promise.resolve({
            doc: parseDocument('<div id="usertags_outer"></div>'),
            url: "https://e-hentai.org/mytags",
          }),
        addTag: (url: string, body: URLSearchParams) => {
          calls.push({ url, body });
          return Promise.resolve();
        },
      }),
    );

    expect(result).toBe("added");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://e-hentai.org/mytags");
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      usertag_action: "add",
      tagname_new: "female:enema",
      tagweight_new: "10",
      usertag_target: "0",
      taghide_new: "on",
    });
  });

  test("reports an API error", async () => {
    await expect(
      applyMyTag(
        "female:enema",
        { watched: true },
        deps({
          post: () => Promise.resolve({ error: "Not gold star" }),
        }),
      ),
    ).rejects.toThrow("Could not save tag: Not gold star");
  });

  test("hiding a watched tag clears the watch flag", async () => {
    let body: Record<string, unknown> = {};
    await applyMyTag(
      "female:enema",
      { hidden: true },
      deps({
        post: (_url: string, payload: unknown) => {
          body = payload as Record<string, unknown>;
          return Promise.resolve({ tagid: 42 });
        },
      }),
    );
    expect(body.taghide).toBe(1);
    expect(body.tagwatch).toBe(0);
  });
});
