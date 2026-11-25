import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { postComment, rateGallery } from "../../src/data/gallery-actions";
import { getSettings, updateSettings } from "../../src/settings";
import type { GalleryApiConfig } from "../../src/types";
import { parseDocument } from "../dom";

Object.assign(globalThis, { location: new URL("https://e-hentai.org/g/123456/abcdef1234/") });

const calls: { url: string; body: unknown }[] = [];

interface RequestInitWithBody extends RequestInit {
  body: string;
}

const originalFetch = globalThis.fetch;
const originalInterval = getSettings().netIntervalMs;

// The real queue reads these; zero keeps consecutive posts from waiting on the request interval.
beforeAll(() => {
  updateSettings({ netIntervalMs: 0 });
});

afterAll(() => {
  updateSettings({ netIntervalMs: originalInterval });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  calls.length = 0;
  // Stub the transport, not `net/http`: a `mock.module` registration outlives the file and would
  // replace the real functions for every later test in a shared `bun test` process.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInitWithBody) => {
    calls.push({
      url: requestUrl(input),
      body: JSON.parse(init?.body ?? "{}") as unknown,
    });
    return Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function config(apiUrl: string): GalleryApiConfig {
  return { apiUrl, apiUid: "1", apiKey: "secret", gid: "123456", token: "abcdef1234" };
}

describe("gallery action endpoints", () => {
  test("the site's API subdomain and a relative endpoint are accepted", async () => {
    await rateGallery(config("https://api.e-hentai.org/api.php"), 5);
    expect(calls[0]?.url).toBe("https://api.e-hentai.org/api.php");
    expect(calls[0]?.body).toMatchObject({ apikey: "secret", method: "rategallery" });

    await rateGallery(config("/api.php"), 5);
    expect(calls[1]?.url).toBe("https://e-hentai.org/api.php");
  });

  test("an off-site endpoint never receives the API key", async () => {
    await expect(rateGallery(config("https://evil.example/api.php"), 5)).rejects.toThrow(
      /not on this site/,
    );
    // Nor does a lookalike host that only ends with the site's name as a label.
    await expect(
      rateGallery(config("https://e-hentai.org.evil.example/api.php"), 5),
    ).rejects.toThrow(/not on this site/);
    await expect(rateGallery(config("http://api.e-hentai.org/api.php"), 5)).rejects.toThrow(
      /not on this site/,
    );

    expect(calls).toHaveLength(0);
  });

  test("a comment POST returns the gallery page it answered with", async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const parser = globals.DOMParser;
    globals.DOMParser = class {
      parseFromString(text: string): Document {
        return parseDocument(text);
      }
    };
    const url = "https://e-hentai.org/g/123456/abcdef1234/";
    try {
      const page = "<!doctype html><html><body><div id='cdiv'></div></body></html>";
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(page, { headers: { "content-type": "text/html" } }),
        )) as unknown as typeof fetch;

      const result = await postComment(url, "hello");
      expect(result?.doc.querySelector("#cdiv")).not.toBeNull();
      // A fabricated Response has no final URL, so the request URL becomes the base.
      expect(result?.url).toBe(url);

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response('{"error":"busy"}', { headers: { "content-type": "application/json" } }),
        )) as unknown as typeof fetch;
      expect(await postComment(url, "hello")).toBeUndefined();
    } finally {
      if (parser === undefined) {
        delete globals.DOMParser;
      } else {
        globals.DOMParser = parser;
      }
    }
  });
});
