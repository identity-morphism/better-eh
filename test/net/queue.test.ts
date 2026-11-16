import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PRIORITY_CLASSES, priorityOf } from "../../src/net/priority";
import { RequestQueue } from "../../src/net/queue";
import { getSettings, updateSetting } from "../../src/settings";
import type { Deferred } from "../ui/async";
import { deferred, failure } from "../ui/async";

const realFetch = globalThis.fetch;

/** Replace the global transport; the queue always calls it with a plain URL string. */
function stubFetch(run: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return run(url, init);
  }) as typeof fetch;
}

let interval: number;
let concurrency: number;

beforeEach(() => {
  interval = getSettings().netIntervalMs;
  concurrency = getSettings().netConcurrency;
  // One slot and no wait: the queue's ordering is what these tests measure, not its pacing.
  updateSetting("netIntervalMs", 0);
  updateSetting("netConcurrency", 1);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  updateSetting("netIntervalMs", interval);
  updateSetting("netConcurrency", concurrency);
});

describe("RequestQueue cancellation", () => {
  test("an aborted queued request never reaches the transport", async () => {
    const calls: string[] = [];
    const responses = new Map<string, Deferred<Response>>();
    stubFetch((url) => {
      calls.push(url);
      const entry = deferred<Response>();
      responses.set(url, entry);
      return entry.promise;
    });

    const queue = new RequestQueue();
    const first = queue.fetch("https://example.test/first");
    const controller = new AbortController();
    const second = queue.fetch("https://example.test/second", { signal: controller.signal });
    controller.abort();
    const secondError = await failure(() => second);
    expect(secondError.name).toBe("AbortError");

    const third = queue.fetch("https://example.test/third");
    const firstResponse = responses.get("https://example.test/first");
    if (!firstResponse) {
      throw new Error("the first request never started");
    }
    firstResponse.resolve(new Response("ok"));
    await first;

    // Aborting the queued task must not spend the single slot — even for one instant — on a
    // request nobody awaits: the third request is the one that starts next.
    expect(calls).toEqual(["https://example.test/first", "https://example.test/third"]);

    const thirdResponse = responses.get("https://example.test/third");
    if (!thirdResponse) {
      throw new Error("the third request never started");
    }
    thirdResponse.resolve(new Response("ok"));
    await third;
  });

  test("an aborted running request aborts the transport signal", async () => {
    let transportSignal: AbortSignal | undefined;
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal ?? undefined;
          transportSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const queue = new RequestQueue();
    const controller = new AbortController();
    const request = queue.fetch("https://example.test/slow", { signal: controller.signal });
    controller.abort();

    const error = await failure(() => request);
    expect(error.name).toBe("AbortError");
    expect(transportSignal?.aborted).toBe(true);
  });
});

describe("RequestQueue purge", () => {
  test("does not disguise purged work as a caller abort", async () => {
    stubFetch(() => new Promise<Response>(() => {}));

    const queue = new RequestQueue();
    // Occupy the only slot so the tagged request is still queued when the purge runs.
    void queue.fetch("https://example.test/running");
    const queued = queue.fetch("https://example.test/queued", { tag: "prefetch" });
    queue.purge((task) => task.tag === "prefetch");

    const error = await failure(() => queued);
    expect(error.name).toBe("RequestPurgedError");
    expect(error).not.toBeInstanceOf(DOMException);
  });
});

describe("priority policy", () => {
  test("the named classes are strictly ordered with prefetch last", () => {
    const values = PRIORITY_CLASSES.map((name) => priorityOf(name));

    for (let index = 1; index < values.length; index++) {
      const current = values[index];
      const previous = values[index - 1];
      if (current === undefined || previous === undefined) {
        throw new Error("priority class has no value");
      }
      expect(current).toBeLessThan(previous);
    }
    expect(priorityOf("prefetch")).toBe(Math.min(...values));
  });

  test("a facing request starts before a prefetch request at the same availability", async () => {
    const calls: string[] = [];
    const blocking = deferred<Response>();
    stubFetch((url) => {
      calls.push(url);
      return url.endsWith("/blocking") ? blocking.promise : Promise.resolve(new Response("ok"));
    });

    const queue = new RequestQueue();
    // The only slot is busy, so both requests wait at the same availability.
    void queue.fetch("https://example.test/blocking");
    const prefetch = queue.fetch("https://example.test/warm", {
      priority: priorityOf("prefetch"),
    });
    const facing = queue.fetch("https://example.test/facing", {
      priority: priorityOf("facing"),
    });

    blocking.resolve(new Response("ok"));
    await Promise.all([prefetch, facing]);

    expect(calls).toEqual([
      "https://example.test/blocking",
      "https://example.test/facing",
      "https://example.test/warm",
    ]);
  });
});
