import { afterAll, beforeEach, expect, test } from "bun:test";

import { DOMParser } from "linkedom";

import { loadTorrentInfo } from "../../src/data/gallery-torrents";
import { getSettings, updateSettings } from "../../src/settings";

const PAGE_URL = "https://e-hentai.org/gallerytorrents.php?gid=987654&t=abcdef1234";
const realFetch = globalThis.fetch;
const interval = getSettings().netIntervalMs;

beforeEach(() => {
  updateSettings({ netIntervalMs: 0 });
  Object.assign(globalThis, { DOMParser });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  updateSettings({ netIntervalMs: interval });
});

function respond(html: string): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
  }) as typeof fetch;
  return calls;
}

test("posts the torrent id and parses the details answer", async () => {
  const html = await Bun.file(`${import.meta.dir}/../fixtures/gallerytorrents-info.html`).text();
  const calls = respond(html);

  const info = await loadTorrentInfo(PAGE_URL, "12345");

  expect(info.name).toBe("Test Gallery.zip");
  expect(info.seeds).toBe(12);
  expect(calls[0]?.url).toBe(PAGE_URL);
  expect(calls[0]?.init?.method).toBe("POST");
  const body = calls[0]?.init?.body;
  if (!(body instanceof URLSearchParams)) {
    throw new Error("expected a form body");
  }
  expect(body.get("gtid")).toBe("12345");
  expect(body.get("torrent_info")).toBe("Information");
});

test("rejects an answer without the info block", async () => {
  respond("<p>Not found</p>");

  await expect(loadTorrentInfo(PAGE_URL, "missing")).rejects.toThrow(
    "The torrent information could not be read.",
  );
});
