import { describe, expect, test } from "bun:test";

import { HttpError, LoginRequiredError, RateLimitedError } from "../../src/fetch/errors";
import { createPageLoader, loader } from "../../src/fetch/loader";
import { priorityOf } from "../../src/net/priority";
import { net } from "../../src/net/queue";
import { getSettings, updateSetting } from "../../src/settings";
import type { PageData } from "../../src/types";
import { parseDocument } from "../dom";
import { failure } from "../ui/async";

const VIEWER_URL = "https://e-hentai.org/s/hash123/987654-2";
const OTHER_VIEWER_URL = "https://e-hentai.org/s/hash456/111111-1";
const GALLERY_URL = "https://e-hentai.org/g/987654/abcdef1234/";

function viewerUrl(index: number): string {
  return `https://e-hentai.org/s/hash123/987654-${index}`;
}

async function fixtureHtml(name: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/../fixtures/${name}`).text();
}

function htmlResponse(body: string, url?: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  if (url) {
    Object.defineProperty(response, "url", { value: url });
  }
  return response;
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function page(url: string, nlToken: string | null = null): PageData {
  return {
    viewerUrl: url,
    pageNum: 1,
    counterText: "1 / 1",
    galleryTitle: { leading: [], primary: "Title", secondary: null, trailing: [] },
    imgSrc: "https://img.example/pages/1.jpg",
    originalHref: null,
    nextHref: null,
    prevHref: null,
    fileInfo: "",
    galleryHref: "",
    nlToken,
    firstHref: null,
    lastHref: null,
    forumHref: null,
    searchHref: null,
  };
}

function harness(respond: (url: string) => Response) {
  const calls: string[] = [];
  const requests: { priority?: number; signal?: AbortSignal }[] = [];
  let purges = 0;
  const pageLoader = createPageLoader({
    request: (url, options) => {
      calls.push(url);
      requests.push({ priority: options.priority, signal: options.signal });
      return Promise.resolve(respond(url));
    },
    parseHtml: (text) => parseDocument(text),
    purgeQueue: () => {
      purges += 1;
    },
  });
  return { loader: pageLoader, calls, requests, purges: () => purges };
}

describe("PageLoader.document", () => {
  test("parses the HTML and caches it by requested URL, fresh bypassing the cache", async () => {
    const html = await fixtureHtml("gallery.html");
    const h = harness(() => htmlResponse(html));

    const first = await h.loader.document(GALLERY_URL);
    const second = await h.loader.document(GALLERY_URL);

    expect(first.url).toBe(GALLERY_URL);
    expect(second).toBe(first);
    expect(h.calls).toEqual([GALLERY_URL]);

    await h.loader.document(GALLERY_URL, { fresh: true });
    const cached = await h.loader.document(GALLERY_URL);

    expect(cached.url).toBe(GALLERY_URL);
    expect(h.calls).toEqual([GALLERY_URL, GALLERY_URL]);
  });

  test("cache: false stores neither the requested nor the final URL", async () => {
    const html = await fixtureHtml("gallery.html");
    const requested = `${GALLERY_URL}?from=list`;
    const h = harness(() => htmlResponse(html, GALLERY_URL));

    await h.loader.document(requested, { cache: false });
    // Neither the requested nor the final URL was stored, so both load again.
    await h.loader.document(GALLERY_URL);
    await h.loader.document(requested);

    expect(h.calls).toEqual([requested, GALLERY_URL, requested]);
  });

  test("names the document, viewer and retry priorities", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html));

    await h.loader.document(GALLERY_URL);
    await h.loader.viewerPage(VIEWER_URL);
    await h.loader.retryWithNl(page(OTHER_VIEWER_URL, "777"));

    expect(h.requests.map((request) => request.priority)).toEqual([
      priorityOf("navigation"),
      priorityOf("facing"),
      priorityOf("critical"),
    ]);
  });

  test("rejects unusable responses with their text or an HttpError", async () => {
    const plain = harness(() => textResponse("Service unavailable"));
    const textError = await failure(() => plain.loader.document(GALLERY_URL));

    expect(textError.message).toBe("Service unavailable");
    expect(plain.purges()).toBe(0);

    const missing = harness(() => textResponse("missing", 404));
    const httpError = await failure(() => missing.loader.document(GALLERY_URL));

    expect(httpError).toBeInstanceOf(HttpError);
    expect(httpError).toMatchObject({ status: 404, url: GALLERY_URL });
  });

  test("turns the login wall into LoginRequiredError", async () => {
    const html = '<!doctype html><html><body><div id="sadpanda">nope</div></body></html>';
    const h = harness(() => htmlResponse(html));

    const error = await failure(() => h.loader.document(VIEWER_URL));

    expect(error).toBeInstanceOf(LoginRequiredError);
  });

  test("purges the queue and raises RateLimitedError on a throttle notice", async () => {
    const notice = "You are opening pages too fast. Please wait a bit.";

    for (const status of [200, 509]) {
      const h = harness(() => textResponse(notice, status));

      const error = await failure(() => h.loader.document(GALLERY_URL));

      expect(error).toBeInstanceOf(RateLimitedError);
      expect(error).toMatchObject({ text: notice });
      expect(h.purges()).toBe(1);
      expect(h.calls).toEqual([GALLERY_URL]);

      // Nothing is cached, so a retry transports again and purges again.
      await failure(() => h.loader.document(GALLERY_URL));
      expect(h.purges()).toBe(2);
      expect(h.calls).toEqual([GALLERY_URL, GALLERY_URL]);
    }
  });
});

describe("PageLoader document cache isolation", () => {
  test("warming 30 viewer pages does not evict a route document", async () => {
    const galleryHtml = await fixtureHtml("gallery.html");
    const viewerHtml = await fixtureHtml("viewer.html");
    const h = harness((url) =>
      url === GALLERY_URL ? htmlResponse(galleryHtml) : htmlResponse(viewerHtml),
    );

    const route = await h.loader.document(GALLERY_URL);
    for (let index = 0; index < 30; index++) {
      await h.loader.viewerPage(viewerUrl(index));
    }

    // The document cache still holds the route: viewer loads never inserted into it.
    expect(await h.loader.document(GALLERY_URL)).toBe(route);
    expect(h.calls.filter((url) => url === GALLERY_URL)).toHaveLength(1);

    // Nor is a viewer load's document available through `document()`; that path refetches.
    await h.loader.document(viewerUrl(0));
    expect(h.calls.filter((url) => url === viewerUrl(0))).toHaveLength(2);
  });
});

describe("PageLoader.viewerPage", () => {
  test("parses viewer data and caches it under requested and final URL", async () => {
    const html = await fixtureHtml("viewer.html");
    const requested = `${VIEWER_URL}?from=list`;
    const h = harness(() => htmlResponse(html, VIEWER_URL));

    const first = await h.loader.viewerPage(requested);

    expect(first.viewerUrl).toBe(VIEWER_URL);
    expect(first.imgSrc).toBe("https://img.example/pages/2.jpg");
    expect(first.nlToken).toBe("777-abc");

    expect(await h.loader.viewerPage(requested)).toBe(first);
    expect(await h.loader.viewerPage(VIEWER_URL)).toBe(first);
    expect(h.calls).toEqual([requested]);
  });

  test("seedViewerPage respects the page-cache bound", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html));

    // Seed well past the bound: the oldest seed falls out while the newest stays cached.
    for (let index = 0; index < 100; index++) {
      h.loader.seedViewerPage(viewerUrl(index), page(viewerUrl(index)));
    }

    expect(await h.loader.viewerPage(viewerUrl(99))).toMatchObject({
      viewerUrl: viewerUrl(99),
    });
    expect(h.calls).toEqual([]);

    await h.loader.viewerPage(viewerUrl(0));
    expect(h.calls).toEqual([viewerUrl(0)]);
  });
});

describe("PageLoader.viewerPage in flight", () => {
  test("shares one request between concurrent callers", async () => {
    const html = await fixtureHtml("viewer.html");
    const calls: string[] = [];
    const gate = Promise.withResolvers<Response>();
    const pageLoader = createPageLoader({
      request: (url) => {
        calls.push(url);
        return gate.promise;
      },
      parseHtml: (text) => parseDocument(text),
      purgeQueue: () => undefined,
    });

    const first = pageLoader.viewerPage(VIEWER_URL);
    const second = pageLoader.viewerPage(VIEWER_URL);
    gate.resolve(htmlResponse(html, VIEWER_URL));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(calls).toEqual([VIEWER_URL]);
  });

  test("aborting the wait keeps the request and caches the result", async () => {
    const html = await fixtureHtml("viewer.html");
    const calls: string[] = [];
    const gate = Promise.withResolvers<Response>();
    const pageLoader = createPageLoader({
      request: (url) => {
        calls.push(url);
        return gate.promise;
      },
      parseHtml: (text) => parseDocument(text),
      purgeQueue: () => undefined,
    });

    const controller = new AbortController();
    const waited = pageLoader.viewerPage(VIEWER_URL, { signal: controller.signal });
    controller.abort();

    const error = await failure(() => waited);
    expect(error.name).toBe("AbortError");

    // The transport was not canceled: the abandoned navigation's page still fills the cache.
    gate.resolve(htmlResponse(html, VIEWER_URL));
    const loaded = await pageLoader.viewerPage(VIEWER_URL);
    expect(loaded.viewerUrl).toBe(VIEWER_URL);
    expect(calls).toEqual([VIEWER_URL]);
  });
});

describe("PageLoader.viewerPage cancellation", () => {
  test("a cancelable load aborts the transport and caches nothing", async () => {
    const gate = Promise.withResolvers<Response>();
    let transportSignal: AbortSignal | undefined;
    const calls: string[] = [];
    const pageLoader = createPageLoader({
      request: (url, options) => {
        calls.push(url);
        transportSignal = options.signal;
        options.signal?.addEventListener(
          "abort",
          () => {
            gate.reject(options.signal?.reason);
          },
          { once: true },
        );
        return gate.promise;
      },
      parseHtml: parseDocument,
      purgeQueue: () => undefined,
    });

    const owner = new AbortController();
    const load = pageLoader.viewerPage(VIEWER_URL, { signal: owner.signal, cancel: true });
    owner.abort();

    const error = await failure(() => load);
    expect(error.name).toBe("AbortError");
    expect(transportSignal?.aborted).toBe(true);
    // Nothing was cached: the transport never delivered a page, so a later call would ask again.
    expect(calls).toEqual([VIEWER_URL]);
  });

  test("an ordinary joiner protects the shared load from the owner's cancel", async () => {
    const html = await fixtureHtml("viewer.html");
    const gate = Promise.withResolvers<Response>();
    let transportSignal: AbortSignal | undefined;
    const pageLoader = createPageLoader({
      request: (_url, options) => {
        transportSignal = options.signal;
        return gate.promise;
      },
      parseHtml: parseDocument,
      purgeQueue: () => undefined,
    });

    const owner = new AbortController();
    const first = pageLoader.viewerPage(VIEWER_URL, { signal: owner.signal, cancel: true });
    const joined = pageLoader.viewerPage(VIEWER_URL);
    owner.abort();

    const ownerError = await failure(() => first);
    expect(ownerError.name).toBe("AbortError");
    // The navigation now owns the request, so the abort must not cancel it.
    expect(transportSignal?.aborted).toBe(false);

    gate.resolve(htmlResponse(html, VIEWER_URL));
    const loaded = await joined;
    expect(loaded.viewerUrl).toBe(VIEWER_URL);
    expect(await pageLoader.viewerPage(VIEWER_URL)).toBe(loaded);
  });
});

describe("PageLoader.retryWithNl", () => {
  test("returns null without a token or when the retry itself fails", async () => {
    const withoutToken = harness(() => htmlResponse("unused"));

    expect(await withoutToken.loader.retryWithNl(page(VIEWER_URL))).toBeNull();
    expect(withoutToken.calls).toEqual([]);

    const failing = harness(() => textResponse("gone", 404));

    expect(await failing.loader.retryWithNl(page(VIEWER_URL, "777"))).toBeNull();
    expect(failing.calls).toEqual([`${VIEWER_URL}?nl=777`]);
  });

  test("refetches with an encoded ?nl= and caches the retried page", async () => {
    const html = await fixtureHtml("viewer.html");
    const retryUrl = `${VIEWER_URL}?nl=12%2034%2656`;
    const h = harness(() => htmlResponse(html, retryUrl));

    const retried = await h.loader.retryWithNl(page(VIEWER_URL, "12 34&56"));
    if (!retried) {
      throw new Error("expected a retried page");
    }

    expect(h.calls).toEqual([retryUrl]);
    expect(retried.viewerUrl).toBe(VIEWER_URL);
    expect(retried.nlToken).toBe("777-abc");

    expect(await h.loader.viewerPage(VIEWER_URL)).toBe(retried);
    expect(h.calls).toHaveLength(1);
  });

  test("puts the nl token before a viewer URL fragment is stripped", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html));

    const retried = await h.loader.retryWithNl(page(`${VIEWER_URL}#reads`, "777"));

    expect(h.calls).toEqual([`${VIEWER_URL}?nl=777`]);
    expect(retried?.viewerUrl).toBe(`${VIEWER_URL}#reads`);
  });

  test("reuses a newer cached page instead of fetching the no-limit URL", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html, VIEWER_URL));

    const newer = await h.loader.viewerPage(VIEWER_URL);
    const stale = page(VIEWER_URL, "777");

    expect(await h.loader.retryWithNl(stale)).toBe(newer);
    expect(h.calls).toEqual([VIEWER_URL]);
  });

  test("retries at a caller-chosen priority", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html));

    const retried = await h.loader.retryWithNl(page(VIEWER_URL, "777"), {
      priority: priorityOf("prefetch"),
    });

    expect(retried?.viewerUrl).toBe(VIEWER_URL);
    expect(h.requests.map((request) => request.priority)).toEqual([priorityOf("prefetch")]);
  });

  test("honours the retry signal", async () => {
    const html = await fixtureHtml("viewer.html");
    const h = harness(() => htmlResponse(html));

    const aborted = new AbortController();
    aborted.abort();
    expect(
      await h.loader.retryWithNl(page(VIEWER_URL, "777"), { signal: aborted.signal }),
    ).toBeNull();
    expect(h.calls).toEqual([]);

    const controller = new AbortController();
    const retried = await h.loader.retryWithNl(page(VIEWER_URL, "777"), {
      signal: controller.signal,
    });

    expect(retried?.viewerUrl).toBe(VIEWER_URL);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]?.signal).toBe(controller.signal);
  });
});

describe("production loader throttle purge", () => {
  test("spares a queued critical POST and drops a speculative prefetch", async () => {
    const realFetch = globalThis.fetch;
    const concurrency = getSettings().netConcurrency;
    const interval = getSettings().netIntervalMs;
    const notice = "You are opening pages too fast. Please wait a bit.";
    const calls: string[] = [];
    const postGate = Promise.withResolvers<Response>();
    updateSetting("netConcurrency", 1);
    updateSetting("netIntervalMs", 0);
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.endsWith("/post")) {
        return postGate.promise;
      }
      if (url.endsWith("/throttled")) {
        return Promise.resolve(textResponse(notice, 509));
      }
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    try {
      // The throttled document starts first; the gated POST then holds the only slot while the
      // notice is handled, so the prefetch is still queued when the purge runs.
      const throttled = loader.document("https://example.test/throttled");
      const post = net.fetch("https://example.test/post", {
        priority: priorityOf("critical"),
        tag: "favorite",
        init: { method: "POST" },
      });
      const warm = net.fetch("https://example.test/warm", {
        priority: priorityOf("prefetch"),
        tag: "prefetch",
      });

      const error = await failure(() => throttled);
      expect(error).toBeInstanceOf(RateLimitedError);

      const purged = await failure(() => warm);
      expect(purged.name).toBe("RequestPurgedError");

      postGate.resolve(new Response("ok"));
      await post;
      expect(calls).toEqual(["https://example.test/throttled", "https://example.test/post"]);
    } finally {
      globalThis.fetch = realFetch;
      updateSetting("netConcurrency", concurrency);
      updateSetting("netIntervalMs", interval);
    }
  });
});
