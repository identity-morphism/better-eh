import { expect, test } from "bun:test";

import { RELEASE_URLS, ReleaseCheckError, verifyRelease } from "../../scripts/verify-release";

const VERSION = "1.1.1";

interface Reply {
  status?: number;
  body?: string;
  cors?: boolean;
  throws?: boolean;
}

function header(version: string): string {
  return `// ==UserScript==\n// @version ${version}\n// ==/UserScript==\n`;
}

function fakeFetch(replies: Record<string, Reply>): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = replies[url];
    if (reply === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (reply.throws === true) {
      return Promise.reject(new Error("offline"));
    }
    const headers = new Headers();
    if (reply.cors !== false) {
      headers.set("access-control-allow-origin", "*");
    }
    return Promise.resolve(
      new Response(reply.body ?? "", { status: reply.status ?? 200, headers }),
    );
  }) as typeof fetch;
}

function goodReplies(): Record<string, Reply> {
  const replies: Record<string, Reply> = {};
  for (const base of [RELEASE_URLS.raw, RELEASE_URLS.cdn]) {
    replies[`${base}/assets/tag-index.bin`] = { body: "" };
    replies[`${base}/assets/tag-counts.bin`] = { body: "" };
  }
  replies[`${RELEASE_URLS.raw}/dist/better-eh.user.js`] = { body: header(VERSION) };
  replies[RELEASE_URLS.latest] = { body: header(VERSION) };
  replies[RELEASE_URLS.sleazy] = { body: header("1.0.10") };
  return replies;
}

test("accepts the published set and warns when the listing lags", async () => {
  const warnings: string[] = [];

  await verifyRelease(
    fakeFetch(goodReplies()),
    VERSION,
    (message) => warnings.push(message),
    () => undefined,
  );

  expect(warnings.join("\n")).toContain("serves 1.0.10");
});

test("rejects an asset without the CORS wildcard", async () => {
  const replies = goodReplies();
  replies[`${RELEASE_URLS.raw}/assets/tag-index.bin`] = { cors: false };

  await expect(
    verifyRelease(
      fakeFetch(replies),
      VERSION,
      () => undefined,
      () => undefined,
    ),
  ).rejects.toBeInstanceOf(ReleaseCheckError);
});

test("rejects a published userscript with another version", async () => {
  const replies = goodReplies();
  replies[`${RELEASE_URLS.raw}/dist/better-eh.user.js`] = { body: header("1.0.0") };

  await expect(
    verifyRelease(
      fakeFetch(replies),
      VERSION,
      () => undefined,
      () => undefined,
    ),
  ).rejects.toThrow("published @version 1.0.0");
});

test("keeps the listing advisory when its host is unreachable", async () => {
  const replies = goodReplies();
  replies[RELEASE_URLS.sleazy] = { throws: true };
  const warnings: string[] = [];

  await verifyRelease(
    fakeFetch(replies),
    VERSION,
    (message) => warnings.push(message),
    () => undefined,
  );

  expect(warnings.join("\n")).toContain("could not check");
});
