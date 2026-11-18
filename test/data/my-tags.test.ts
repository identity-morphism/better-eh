import { describe, expect, test } from "bun:test";

import type { GalleryPost } from "../../src/data/gallery-actions";
import { applyMyTag, normalizeWeight } from "../../src/data/my-tags";
import type { DocumentOptions, HtmlResponse } from "../../src/fetch/loader";
import type { UserTagState } from "../../src/parse/my-tags";
import { normalizeColor, parseUserTags } from "../../src/parse/my-tags";
import type { GalleryApiConfig } from "../../src/types";
import { parseDocument } from "../dom";

const CONFIG: GalleryApiConfig = {
  apiUrl: "https://api.e-hentai.org/api.php",
  apiUid: "777",
  apiKey: "key123",
  gid: "123456",
  token: "abcdef1234",
};

const MYTAGS_URL = "https://e-hentai.org/mytags";

function doc(): Document {
  return parseDocument(`
    <div id="usertags_outer">
      <div id="usertag_0">
        <input id="tagwatch_0" type="checkbox">
      </div>
      <div id="usertag_42">
        <div id="tagpreview_42" title="female:entry"></div>
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

interface DepsOverrides {
  loadDocument?: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  post?: GalleryPost;
  addTag?: (url: string, body: URLSearchParams, signal?: AbortSignal) => Promise<void>;
  existing?: UserTagState;
  signal?: AbortSignal;
}

function deps(overrides: DepsOverrides = {}) {
  return {
    config: CONFIG,
    myTagsUrl: MYTAGS_URL,
    loadDocument: () => Promise.resolve({ doc: doc(), url: MYTAGS_URL }),
    ...overrides,
  };
}

describe("My Tags parsing", () => {
  test("reads the saved tags and their current flags", () => {
    const tags = parseUserTags(doc());
    expect(tags).toEqual([
      {
        id: 42,
        name: "female:entry",
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

describe("normalizeWeight", () => {
  test("rounds to whole numbers and clamps to the site's range", () => {
    expect(normalizeWeight(12.6)).toBe(13);
    expect(normalizeWeight(150)).toBe(99);
    expect(normalizeWeight(-150)).toBe(-99);
    expect(normalizeWeight(0)).toBe(0);
  });

  test("defaults missing or malformed weights to 10", () => {
    expect(normalizeWeight(undefined)).toBe(10);
    expect(normalizeWeight(null)).toBe(10);
    expect(normalizeWeight(Number.NaN)).toBe(10);
    expect(normalizeWeight(Number.POSITIVE_INFINITY)).toBe(10);
  });
});

describe("My Tags mutations", () => {
  test("updates an existing tag through setusertag and preserves other fields", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    await applyMyTag(
      "Female:entry",
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

  test("updates the weight through setusertag and keeps watch/hide/colour", async () => {
    let body: Record<string, unknown> = {};
    await applyMyTag(
      "language:english",
      { weight: 30 },
      deps({
        post: (_url: string, payload: unknown) => {
          body = payload as Record<string, unknown>;
          return Promise.resolve({ tagid: 43 });
        },
      }),
    );

    expect(body).toEqual({
      method: "setusertag",
      apiuid: CONFIG.apiUid,
      apikey: CONFIG.apiKey,
      tagid: 43,
      tagwatch: 0,
      taghide: 1,
      tagcolor: "",
      tagweight: 30,
    });
  });

  test("uses injected existing state without fetching My Tags", async () => {
    const existing: UserTagState = {
      id: 42,
      name: "female:entry",
      watched: true,
      hidden: false,
      color: "#ff8800",
      weight: 15,
    };
    let fetched = false;
    let body: Record<string, unknown> = {};
    const result = await applyMyTag(
      "female:entry",
      { weight: 25 },
      deps({
        existing,
        loadDocument: () => {
          fetched = true;
          throw new Error("the tag list should not be fetched");
        },
        post: (_url: string, payload: unknown) => {
          body = payload as Record<string, unknown>;
          return Promise.resolve({ tagid: existing.id });
        },
      }),
    );

    expect(result).toBe("updated");
    expect(fetched).toBe(false);
    expect(body.tagwatch).toBe(1);
    expect(body.taghide).toBe(0);
    expect(body.tagcolor).toBe("#ff8800");
    expect(body.tagweight).toBe(25);
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
      "female:entry",
      { hidden: true },
      deps({
        loadDocument: () =>
          Promise.resolve({
            doc: parseDocument('<div id="usertags_outer"></div>'),
            url: MYTAGS_URL,
          }),
        addTag: (url: string, body: URLSearchParams) => {
          calls.push({ url, body });
          return Promise.resolve();
        },
      }),
    );

    expect(result).toBe("added");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(MYTAGS_URL);
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      usertag_action: "add",
      tagname_new: "female:entry",
      tagweight_new: "10",
      usertag_target: "0",
      taghide_new: "on",
    });
  });

  test("sends the chosen weight when adding a tag", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    await applyMyTag(
      "artist:someone",
      { weight: 42, watched: true },
      deps({
        loadDocument: () =>
          Promise.resolve({
            doc: parseDocument('<div id="usertags_outer"></div>'),
            url: MYTAGS_URL,
          }),
        addTag: (url: string, body: URLSearchParams) => {
          calls.push({ url, body });
          return Promise.resolve();
        },
      }),
    );

    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      usertag_action: "add",
      tagname_new: "artist:someone",
      tagweight_new: "42",
      usertag_target: "0",
      tagwatch_new: "on",
    });
  });

  test("reports an API error", async () => {
    await expect(
      applyMyTag(
        "female:entry",
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
      "female:entry",
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
