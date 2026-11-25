import { beforeEach, describe, expect, test } from "bun:test";

import type { GalleryPost } from "../../src/data/gallery-actions";
import {
  applyMyTag,
  cacheUserTags,
  lookupUserTag,
  normalizeWeight,
  resetUserTagCache,
  saveTagset,
} from "../../src/data/my-tags";
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

/** One saved-tag block per entry, as `/mytags` renders them. */
function tagList(entries: ReadonlyArray<{ id: number; name: string }>): Document {
  return parseDocument(`
    <div id="usertags_outer">
      ${entries
        .map(
          ({ id, name }) => `
        <div id="usertag_${id}">
          <div id="tagpreview_${id}" title="${name}"></div>
          <input id="tagwatch_${id}" type="checkbox">
          <input id="taghide_${id}" type="checkbox">
          <input id="tagcolor_${id}" value="">
          <input id="tagweight_${id}" value="10">
        </div>`,
        )
        .join("")}
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

beforeEach(resetUserTagCache);

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

    await applyMyTag("Female:Enema", { watched: true }, deps({ post }));
    await applyMyTag("language:english", { weight: 30 }, deps({ post }));
    await applyMyTag("language:english", { color: "#00ff00" }, deps({ post }));
    await applyMyTag("female:enema", { hidden: true }, deps({ post }));

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
          // The previous edit patched the cache, so the weight carries forward like the page would.
          tagweight: 30,
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
      name: "female:enema",
      watched: true,
      hidden: false,
      color: "#ff8800",
      weight: 15,
    };
    let fetched = false;
    let body: Record<string, unknown> = {};
    const result = await applyMyTag(
      "female:enema",
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

  test("resolves a cached id without fetching My Tags", async () => {
    cacheUserTags([
      { id: 77, name: "female:enema", watched: false, hidden: false, color: "", weight: 10 },
    ]);
    let fetched = 0;
    const bodies: Array<Record<string, unknown>> = [];

    const result = await applyMyTag(
      "Female:Enema",
      { color: "#00ff00" },
      deps({
        loadDocument: () => {
          fetched += 1;
          throw new Error("the cached id should skip the page");
        },
        post: (_url, body) => {
          bodies.push(body as Record<string, unknown>);
          return Promise.resolve({});
        },
      }),
    );

    expect(result).toBe("updated");
    expect(fetched).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ method: "setusertag", tagid: 77, tagcolor: "#00ff00" });
    expect(lookupUserTag("female:enema")?.color).toBe("#00ff00");
  });

  test("refreshes a stale cached id and retries the edit once", async () => {
    cacheUserTags([
      { id: 42, name: "female:enema", watched: true, hidden: false, color: "", weight: 10 },
    ]);
    const fresh = tagList([{ id: 55, name: "female:enema" }]);
    const ids: number[] = [];
    let fetches = 0;

    const result = await applyMyTag(
      "female:enema",
      { watched: true },
      deps({
        loadDocument: () => {
          fetches += 1;
          return Promise.resolve({ doc: fresh, url: MYTAGS_URL });
        },
        post: (_url, body) => {
          // applyMyTag builds this body, so the recorder mirrors its one field under test.
          const posted = body as { tagid: number };
          ids.push(posted.tagid);
          return ids.length === 1
            ? Promise.resolve({ error: "Invalid tag id" })
            : Promise.resolve({});
        },
      }),
    );

    expect(result).toBe("updated");
    expect(fetches).toBe(1);
    expect(ids).toEqual([42, 55]);
    expect(lookupUserTag("female:enema")?.id).toBe(55);
  });

  test("re-adds a cached tag the refreshed list no longer has", async () => {
    cacheUserTags([
      { id: 42, name: "female:enema", watched: true, hidden: false, color: "", weight: 10 },
    ]);
    const empty = tagList([]);
    const added: URLSearchParams[] = [];
    let posts = 0;

    const result = await applyMyTag(
      "female:enema",
      { hidden: true },
      deps({
        loadDocument: () => Promise.resolve({ doc: empty, url: MYTAGS_URL }),
        post: () => {
          posts += 1;
          return Promise.resolve({ error: "Invalid tag id" });
        },
        addTag: (_url, body) => {
          added.push(body);
          return Promise.resolve();
        },
      }),
    );

    expect(result).toBe("added");
    expect(posts).toBe(1);
    const addedBody = added[0];
    if (addedBody === undefined) {
      throw new Error("the tag was not added");
    }
    expect(Object.fromEntries(addedBody)).toMatchObject({
      usertag_action: "add",
      tagname_new: "female:enema",
      taghide_new: "on",
    });
    expect(lookupUserTag("female:enema")).toBeUndefined();
  });

  test("does not retry when the id came from the page just fetched", async () => {
    let fetches = 0;
    let posts = 0;

    await expect(
      applyMyTag(
        "female:enema",
        { watched: true },
        deps({
          loadDocument: () => {
            fetches += 1;
            return Promise.resolve({
              doc: tagList([{ id: 42, name: "female:enema" }]),
              url: MYTAGS_URL,
            });
          },
          post: () => {
            posts += 1;
            return Promise.resolve({ error: "Not gold star" });
          },
        }),
      ),
    ).rejects.toThrow("Could not save tag: Not gold star");

    expect(fetches).toBe(1);
    expect(posts).toBe(1);
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
      await applyMyTag("female:enema", { hidden: true }, deps({ loadDocument: emptyList, addTag })),
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
        tagname_new: "female:enema",
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
        "female:enema",
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
