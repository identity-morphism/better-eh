import { describe, expect, mock, test } from "bun:test";

import type { GalleryApiConfig } from "../../src/types";

const calls: { url: string; body: unknown }[] = [];

void mock.module("../../src/net/http", () => ({
  postForm: () => Promise.resolve(new Response("")),
  postJson: (url: string, body: unknown) => {
    calls.push({ url, body });
    return Promise.resolve({});
  },
}));

Object.assign(globalThis, { location: new URL("https://e-hentai.org/g/123456/abcdef1234/") });

// The http mock has to be registered before the action module is evaluated.
const { rateGallery } = await import("../../src/data/gallery-actions");

function config(apiUrl: string): GalleryApiConfig {
  return { apiUrl, apiUid: "1", apiKey: "secret", gid: "123456", token: "abcdef1234" };
}

describe("gallery action endpoints", () => {
  test("the site's API subdomain is accepted", async () => {
    calls.length = 0;

    await rateGallery(config("https://api.e-hentai.org/api.php"), 5);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.e-hentai.org/api.php");
    expect(calls[0]?.body).toMatchObject({ apikey: "secret", method: "rategallery" });
  });

  test("a relative endpoint resolves against the page", async () => {
    calls.length = 0;

    await rateGallery(config("/api.php"), 5);

    expect(calls[0]?.url).toBe("https://e-hentai.org/api.php");
  });

  test("an off-site endpoint never receives the API key", async () => {
    calls.length = 0;

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
});
