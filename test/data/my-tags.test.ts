import { describe, expect, test } from "bun:test";

import type { GalleryPost } from "../../src/data/gallery-actions";
import { applyMyTag, normalizeWeight, saveTagset } from "../../src/data/my-tags";
import type { DocumentOptions, HtmlResponse } from "../../src/fetch/loader";
import type { TagsetState, UserTagState } from "../../src/parse/my-tags";
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
  test("rounds, clamps and defaults missing or malformed weights", () => {
    expect(normalizeWeight(12.6)).toBe(13);
    expect(normalizeWeight(150)).toBe(99);
    expect(normalizeWeight(-150)).toBe(-99);
    expect(normalizeWeight(0)).toBe(0);
    expect(normalizeWeight(undefined)).toBe(10);
    expect(normalizeWeight(null)).toBe(10);
    expect(normalizeWeight(Number.NaN)).toBe(10);
    expect(normalizeWeight(Number.POSITIVE_INFINITY)).toBe(10);
  });
});

describe("My Tags mutations", () => {
  test("posts one setusertag body per edit and preserves the untouched fields", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const post = (url: string, body: unknown) => {
      calls.push({ url, body });
      return Promise.resolve({});
    };

    await applyMyTag("Female:entry", { watched: true }, deps({ post }));
    await applyMyTag("language:english", { weight: 30 }, deps({ post }));
    await applyMyTag("language:english", { color: "#00ff00" }, deps({ post }));
    await applyMyTag("female:entry", { hidden: true }, deps({ post }));

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
      {
        url: CONFIG.apiUrl,
        body: {
          method: "setusertag",
          apiuid: CONFIG.apiUid,
          apikey: CONFIG.apiKey,
          tagid: 43,
          tagwatch: 0,
          taghide: 1,
          tagcolor: "",
          tagweight: 30,
        },
      },
      {
        url: CONFIG.apiUrl,
        body: {
          method: "setusertag",
          apiuid: CONFIG.apiUid,
          apikey: CONFIG.apiKey,
          tagid: 43,
          tagwatch: 0,
          taghide: 1,
          tagcolor: "#00ff00",
          tagweight: 10,
        },
      },
      {
        // Hiding a watched tag clears the watch flag.
        url: CONFIG.apiUrl,
        body: {
          method: "setusertag",
          apiuid: CONFIG.apiUid,
          apikey: CONFIG.apiKey,
          tagid: 42,
          tagwatch: 0,
          taghide: 1,
          tagcolor: "#ff8800",
          tagweight: 15,
        },
      },
    ]);
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

  test("adds a tag missing from My Tags through the native form", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const addTag = (url: string, body: URLSearchParams) => {
      calls.push({ url, body });
      return Promise.resolve();
    };
    const emptyList = () =>
      Promise.resolve({
        doc: parseDocument('<div id="usertags_outer"></div>'),
        url: MYTAGS_URL,
      });

    const results = [
      await applyMyTag("female:entry", { hidden: true }, deps({ loadDocument: emptyList, addTag })),
      await applyMyTag(
        "artist:someone",
        { weight: 42, watched: true },
        deps({ loadDocument: emptyList, addTag }),
      ),
    ];

    expect(results).toEqual(["added", "added"]);
    expect(calls.map((call) => call.url)).toEqual([MYTAGS_URL, MYTAGS_URL]);
    expect(calls.map((call) => Object.fromEntries(call.body))).toEqual([
      {
        usertag_action: "add",
        tagname_new: "female:entry",
        tagweight_new: "10",
        usertag_target: "0",
        taghide_new: "on",
      },
      {
        usertag_action: "add",
        tagname_new: "artist:someone",
        tagweight_new: "42",
        usertag_target: "0",
        tagwatch_new: "on",
      },
    ]);
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
});

const TAGSET: TagsetState = {
  choices: [{ id: "1", label: "Tagset #1 (2)", selected: true }],
  currentId: "1",
  name: "Tagset #1",
  enabled: true,
  color: "#ff8800",
  action: "https://e-hentai.org/mytags?tagset=1",
  fields: [
    { name: "tagset_action", kind: "value", value: "" },
    { name: "tagset_name", kind: "value", value: "" },
    { name: "tagset_enable", kind: "checkbox", value: "on" },
    { name: "tagset_color", kind: "value", value: "#FF8800" },
    { name: "site_marker", kind: "value", value: "keep-me" },
  ],
};

describe("saveTagset", () => {
  test("posts the native update body and preserves unknown fields", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    await saveTagset(
      TAGSET,
      { enabled: false, color: "#00AAFF" },
      {
        post: (url, body) => {
          calls.push({ url, body });
          return Promise.resolve();
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TAGSET.action);
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      tagset_action: "update",
      tagset_name: "",
      tagset_color: "#00aaff",
      site_marker: "keep-me",
    });
    expect(calls[0]?.body.has("tagset_enable")).toBe(false);
  });

  test("renames through the same form and keeps the current toggle and colour", async () => {
    let body = new URLSearchParams();
    await saveTagset(
      TAGSET,
      { name: "Reading queue" },
      {
        post: (_url, next) => {
          body = next;
          return Promise.resolve();
        },
      },
    );

    expect(body.get("tagset_action")).toBe("rename");
    expect(body.get("tagset_name")).toBe("Reading queue");
    expect(body.get("tagset_enable")).toBe("on");
    expect(body.get("tagset_color")).toBe("#FF8800");
    expect(body.get("site_marker")).toBe("keep-me");
  });

  test("emits an empty colour field so the site clears the default", async () => {
    let body = new URLSearchParams();
    await saveTagset(
      TAGSET,
      { color: "" },
      {
        post: (_url, next) => {
          body = next;
          return Promise.resolve();
        },
      },
    );

    expect(body.has("tagset_color")).toBe(true);
    expect(body.get("tagset_color")).toBe("");
  });

  test("does not add an enable field a form never offered", async () => {
    const withoutEnable: TagsetState = {
      ...TAGSET,
      fields: TAGSET.fields.filter((field) => field.name !== "tagset_enable"),
    };
    let body = new URLSearchParams();
    await saveTagset(
      withoutEnable,
      { enabled: true, color: "#FF8800" },
      {
        post: (_url, next) => {
          body = next;
          return Promise.resolve();
        },
      },
    );

    expect(body.has("tagset_enable")).toBe(false);
    expect(body.get("tagset_action")).toBe("update");
  });

  test("rejects a blank name and a malformed colour before posting", async () => {
    let posted = false;
    const post = () => {
      posted = true;
      return Promise.resolve();
    };

    await expect(saveTagset(TAGSET, { name: "   " }, { post })).rejects.toThrow(
      "Enter a tag set name.",
    );
    await expect(saveTagset(TAGSET, { color: "not-a-colour" }, { post })).rejects.toThrow(
      "Use a #rgb or #rrggbb colour, or leave the field empty.",
    );
    expect(posted).toBe(false);
  });
});
